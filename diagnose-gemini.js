'use strict';

/**
 * Diagnostic: makes one real Gemini call and prints the FULL raw response.
 * Run from the project root:  node diagnose-gemini.js
 *
 * Reads GEMINI_API_KEY straight out of server/.env — no dotenv dependency,
 * so it works no matter which folder you run it from.
 */

const fs = require('fs');
const path = require('path');

/** Minimal .env reader: KEY=VALUE per line, ignores comments and blanks. */
function loadEnv(envPath) {
  const out = {};
  let raw;
  try {
    raw = fs.readFileSync(envPath, 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    val = val.replace(/^["']|["']$/g, '');
    out[key] = val;
  }
  return out;
}

const MODEL = 'gemini-2.5-flash';
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

async function main() {
  const envPath = path.join(__dirname, 'server', '.env');
  const env = loadEnv(envPath);
  const key = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;

  if (!key || key === 'your-gemini-api-key-here') {
    console.error('No real GEMINI_API_KEY found in', envPath);
    console.error('Edit server/.env and set GEMINI_API_KEY to your actual key.');
    process.exit(1);
  }
  console.log('Key loaded, length:', key.length);

  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                'Return ONLY this JSON object, nothing else: ' +
                '{"riskScore": 50, "riskCategory": "medium", ' +
                '"reasoning": "test", "tacticsObserved": ["test"]}',
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 2048,
        temperature: 0.2,
      },
    }),
  });

  console.log('HTTP status:', res.status);
  const data = await res.json();
  console.log('--- FULL RESPONSE ---');
  console.log(JSON.stringify(data, null, 2));

  if (data.candidates && data.candidates[0]) {
    const c = data.candidates[0];
    console.log('--- finishReason:', c.finishReason);
    const parts = c.content && c.content.parts;
    console.log('--- parts present:', Array.isArray(parts),
      'count:', parts ? parts.length : 0);
  }
  if (data.usageMetadata) {
    console.log('--- usage:', JSON.stringify(data.usageMetadata));
  }
}

main().catch((e) => console.error('ERROR:', e.message));