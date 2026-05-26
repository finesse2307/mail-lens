'use strict';

/**
 * LLM integration (Google Gemini).
 *
 * After the rule engine runs, we hand the LLM the email plus the
 * deterministic findings and ask it to do what rules cannot: assess the
 * message holistically and explain in plain language.
 *
 * Hard requirement: this module NEVER throws. If the API key is missing, the
 * request errors (including a 429 rate-limit from the free tier), or the
 * response is not valid JSON, it returns { available: false, ... } and the
 * caller falls back to a rules-only result.
 *
 * Uses Gemini's free tier. The free tier is rate limited (a small number of
 * requests per minute / per day); when the limit is hit the API returns 429
 * and the app degrades gracefully, exactly as it does for any other failure.
 */

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const REQUEST_TIMEOUT_MS = 20000;

/**
 * Build the prompt. We give the model the sender info, body, and rule
 * findings, and instruct it to return ONLY a JSON object.
 *
 * Provider-agnostic: this text is identical regardless of which LLM runs it.
 */
function buildPrompt(parsed, findings) {
  const findingsSummary = findings
    .map(
      (f) =>
        `- [${f.passed ? 'PASS' : 'FAIL'}] ${f.label} ` +
        `(severity: ${f.severity}): ${f.detail}`
    )
    .join('\n');

  return [
    'You are a phishing-detection analyst. A deterministic rule engine has',
    'already inspected the email below. Your job is to assess it holistically',
    '— judgment, tone, and social-engineering tactics the rules cannot catch.',
    '',
    '=== SENDER ===',
    `Display name: ${parsed.from.displayName || '(none)'}`,
    `Address: ${parsed.from.address || '(none)'}`,
    `Domain: ${parsed.from.domain || '(none)'}`,
    '',
    '=== SUBJECT ===',
    parsed.subject || '(none)',
    '',
    '=== BODY ===',
    (parsed.body || '(empty)').slice(0, 6000),
    '',
    '=== RULE ENGINE FINDINGS ===',
    findingsSummary || '(no findings)',
    '',
    '=== YOUR TASK ===',
    'Respond with ONLY a single JSON object and nothing else — no prose, no',
    'explanation outside the JSON, no markdown code fences. The object must',
    'have exactly these keys:',
    '{',
    '  "riskScore": <integer 0-100>,',
    '  "riskCategory": <"minimal" | "low" | "medium" | "high">,',
    '  "reasoning": <2-4 sentence plain-language explanation>,',
    '  "tacticsObserved": [<short strings naming social-engineering tactics>]',
    '}',
  ].join('\n');
}

/** Strip accidental markdown fences and isolate the first JSON object. */
function extractJson(text) {
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object found in model response.');
  }
  return JSON.parse(t.slice(start, end + 1));
}

/** Validate and normalize the parsed assessment into a known shape. */
function normalizeAssessment(obj) {
  const categories = ['minimal', 'low', 'medium', 'high'];
  let score = Number(obj.riskScore);
  if (!Number.isFinite(score)) score = 0;
  score = Math.max(0, Math.min(100, Math.round(score)));

  let category = String(obj.riskCategory || '').toLowerCase();
  if (!categories.includes(category)) {
    category = score >= 70 ? 'high' : score >= 40 ? 'medium' : score >= 15 ? 'low' : 'minimal';
  }

  const reasoning =
    typeof obj.reasoning === 'string' && obj.reasoning.trim()
      ? obj.reasoning.trim()
      : 'No reasoning provided.';

  const tactics = Array.isArray(obj.tacticsObserved)
    ? obj.tacticsObserved.map((t) => String(t)).filter(Boolean).slice(0, 12)
    : [];

  return { riskScore: score, riskCategory: category, reasoning, tacticsObserved: tactics };
}

/**
 * Pull the model's text output out of a Gemini generateContent response.
 * Response shape: { candidates: [ { content: { parts: [ { text } ] } } ] }
 *
 * Surfaces finishReason in the error message so failure modes like
 * MAX_TOKENS (the model ran out of output budget) or SAFETY (the response
 * was blocked) are diagnosable instead of a generic parse failure.
 */
function extractGeminiText(data) {
  const candidates = data && data.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    // A blocked prompt has no candidates but does report promptFeedback.
    const block = data && data.promptFeedback && data.promptFeedback.blockReason;
    throw new Error(
      block
        ? `Gemini blocked the prompt (${block}).`
        : 'Gemini response contained no candidates.'
    );
  }
  const candidate = candidates[0];
  const parts = candidate && candidate.content && candidate.content.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    const reason = (candidate && candidate.finishReason) || 'unknown';
    throw new Error(
      `Gemini returned no content parts (finishReason: ${reason}).`
    );
  }
  return parts.map((p) => p.text || '').join('\n');
}

/**
 * Ask the LLM to assess the email.
 *
 * @returns {Promise<{available: boolean, assessment?: object, error?: string}>}
 */
async function assessWithLLM(parsed, findings) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { available: false, error: 'GEMINI_API_KEY is not set.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        // Gemini accepts the API key via this header (kept out of the URL so
        // it never lands in server logs).
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: buildPrompt(parsed, findings) }] },
        ],
        generationConfig: {
          // Ask Gemini to emit raw JSON — far more reliable than parsing
          // JSON back out of free-form prose.
          responseMimeType: 'application/json',
          // gemini-2.5-flash is a reasoning model: it spends output tokens
          // on internal "thinking" before the visible answer. The budget
          // must cover both, or the response comes back with an empty
          // parts array. 2048 comfortably covers thinking + a small JSON
          // object.
          maxOutputTokens: 2048,
          temperature: 0.2,
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      // 429 specifically means the free-tier rate limit was hit.
      const hint =
        response.status === 429
          ? ' (free-tier rate limit reached — try again shortly)'
          : '';
      return {
        available: false,
        error: `Gemini API returned ${response.status}${hint}: ${body.slice(0, 200)}`,
      };
    }

    const data = await response.json();
    const text = extractGeminiText(data);
    const assessment = normalizeAssessment(extractJson(text));
    return { available: true, assessment };
  } catch (err) {
    // Network error, timeout/abort, or JSON parse failure all land here.
    const reason =
      err.name === 'AbortError' ? 'Request to Gemini API timed out.' : err.message;
    return { available: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  assessWithLLM,
  buildPrompt,
  extractJson,
  normalizeAssessment,
  extractGeminiText,
};