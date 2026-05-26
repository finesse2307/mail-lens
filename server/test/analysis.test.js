'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeScores } = require('../src/services/analysisService');
const {
  extractJson,
  normalizeAssessment,
  extractGeminiText,
} = require('../src/services/llmService');
const { runRuleEngine } = require('../src/ruleEngine');
const samples = require('./sampleEmails');

// --- merge logic ----------------------------------------------------------

test('mergeScores: rules-only when AI is unavailable', () => {
  const ruleResult = runRuleEngine(samples.phishingPaypal);
  const merged = mergeScores(ruleResult, null);
  assert.equal(merged.overallRiskScore, ruleResult.baselineScore);
});

test('mergeScores: high-severity baseline acts as a floor', () => {
  const ruleResult = runRuleEngine(samples.phishingPaypal);
  // The LLM tries to talk the score way down.
  const merged = mergeScores(ruleResult, {
    riskScore: 5, riskCategory: 'minimal', reasoning: '', tacticsObserved: [],
  });
  assert.ok(
    merged.overallRiskScore >= ruleResult.baselineScore,
    'high-severity rule failures should not be undercut by the model'
  );
});

test('mergeScores: blends scores for a clean email', () => {
  const ruleResult = runRuleEngine(samples.legitGithub); // baseline ~0
  const merged = mergeScores(ruleResult, {
    riskScore: 50, riskCategory: 'medium', reasoning: '', tacticsObserved: [],
  });
  // 0.6*0 + 0.4*50 = 20, no high-severity floor.
  assert.equal(merged.overallRiskScore, 20);
  assert.equal(merged.overallRiskCategory, 'low');
});

// --- LLM JSON parsing --------------------------------------------------

test('extractJson: parses a bare JSON object', () => {
  const obj = extractJson('{"riskScore": 80, "riskCategory": "high"}');
  assert.equal(obj.riskScore, 80);
});

test('extractJson: strips markdown code fences', () => {
  const obj = extractJson('```json\n{"riskScore": 10}\n```');
  assert.equal(obj.riskScore, 10);
});

test('extractJson: throws when there is no JSON object', () => {
  assert.throws(() => extractJson('the model rambled with no json'));
});

test('normalizeAssessment: clamps an out-of-range score', () => {
  const a = normalizeAssessment({ riskScore: 250, riskCategory: 'high' });
  assert.equal(a.riskScore, 100);
});

test('normalizeAssessment: derives category when missing/invalid', () => {
  const a = normalizeAssessment({ riskScore: 80, riskCategory: 'banana' });
  assert.equal(a.riskCategory, 'high');
});

test('normalizeAssessment: coerces a non-array tactics field', () => {
  const a = normalizeAssessment({ riskScore: 30, tacticsObserved: 'not an array' });
  assert.deepEqual(a.tacticsObserved, []);
});

// --- Gemini response extraction -------------------------------------------

test('extractGeminiText: pulls text out of a well-formed response', () => {
  const data = {
    candidates: [
      { content: { parts: [{ text: '{"riskScore": 42}' }] } },
    ],
  };
  assert.equal(extractGeminiText(data), '{"riskScore": 42}');
});

test('extractGeminiText: joins multiple parts', () => {
  const data = {
    candidates: [
      { content: { parts: [{ text: '{"a":1' }, { text: ',"b":2}' }] } },
    ],
  };
  assert.equal(extractGeminiText(data), '{"a":1\n,"b":2}');
});

test('extractGeminiText: throws when there are no candidates', () => {
  assert.throws(() => extractGeminiText({ candidates: [] }));
  assert.throws(() => extractGeminiText({}));
});

test('extractGeminiText: throws when a candidate has no parts', () => {
  assert.throws(() => extractGeminiText({ candidates: [{ content: {} }] }));
});

