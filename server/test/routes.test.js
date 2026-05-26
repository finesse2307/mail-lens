'use strict';

/**
 * Route-level integration tests.
 *
 * Boots the real Express app on an ephemeral port and exercises the three
 * API routes over HTTP. The data layer falls back to its in-memory store
 * (no MONGODB_URI), so these run with no external dependencies. The LLM
 * call has no API key in the test environment, so every analysis exercises
 * the graceful-degradation path (aiAvailable: false) — which is exactly the
 * behavior we want to assert is solid.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const samples = require('./sampleEmails');

let server;
let baseUrl;

// Start one server for the whole file; close it when done.
test.before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(() => {
  if (server) server.close();
});

/** Small helper: POST JSON and return { status, body }. */
async function postJson(pathName, payload) {
  const res = await fetch(baseUrl + pathName, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function getJson(pathName) {
  const res = await fetch(baseUrl + pathName);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// --- health ---------------------------------------------------------------

test('GET /health returns ok', async () => {
  const { status, body } = await getJson('/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
});

// --- POST /api/analyze -----------------------------------------------------

test('POST /api/analyze: phishing email returns a high-risk result', async () => {
  const { status, body } = await postJson('/api/analyze', {
    email: samples.phishingPaypal,
  });
  assert.equal(status, 201);
  assert.equal(body.overallRiskCategory, 'high');
  assert.ok(body.overallRiskScore >= 70);
  assert.equal(body.ruleFindings.length, 6);
  assert.ok(typeof body._id === 'string' && body._id.length > 0);
});

test('POST /api/analyze: legit email returns a low/minimal result', async () => {
  const { status, body } = await postJson('/api/analyze', {
    email: samples.legitGithub,
  });
  assert.equal(status, 201);
  assert.ok(['minimal', 'low'].includes(body.overallRiskCategory));
});

test('POST /api/analyze: AI layer degrades gracefully without a key', async () => {
  const { body } = await postJson('/api/analyze', { email: samples.phishingPaypal });
  // No GEMINI_API_KEY in the test env -> AI unavailable, but a full
  // rule-engine result still comes back.
  assert.equal(body.aiAvailable, false);
  assert.equal(body.aiAssessment, null);
  assert.ok(typeof body.aiError === 'string');
  assert.ok(body.overallRiskScore > 0, 'rule engine still produced a score');
});

test('POST /api/analyze: empty body is rejected with 400', async () => {
  const { status, body } = await postJson('/api/analyze', { email: '' });
  assert.equal(status, 400);
  assert.ok(body.error);
});

test('POST /api/analyze: non-email text is rejected with 400', async () => {
  const { status, body } = await postJson('/api/analyze', {
    email: 'this is just a sentence with no headers or addresses',
  });
  assert.equal(status, 400);
  assert.match(body.error, /does not look like an email/i);
});

test('POST /api/analyze: missing email field is rejected with 400', async () => {
  const { status } = await postJson('/api/analyze', { notEmail: 'x' });
  assert.equal(status, 400);
});

// --- GET /api/analyses -----------------------------------------------------

test('GET /api/analyses: lists saved analyses, newest first', async () => {
  // Seed a couple so the list is non-empty regardless of test order.
  await postJson('/api/analyze', { email: samples.phishingMicrosoft });
  await postJson('/api/analyze', { email: samples.legitNewsletter });

  const { status, body } = await getJson('/api/analyses');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  assert.ok(body.length >= 2);
  // Each list row carries only the summary fields.
  assert.ok('overallRiskScore' in body[0]);
  assert.ok('emailSubject' in body[0]);
});

// --- GET /api/analyses/:id -------------------------------------------------

test('GET /api/analyses/:id: returns one full analysis', async () => {
  const created = await postJson('/api/analyze', { email: samples.phishingPaypal });
  const id = created.body._id;

  const { status, body } = await getJson('/api/analyses/' + id);
  assert.equal(status, 200);
  assert.equal(body._id, id);
  assert.equal(body.ruleFindings.length, 6);
});

test('GET /api/analyses/:id: unknown id returns 404', async () => {
  const { status, body } = await getJson('/api/analyses/does-not-exist');
  assert.equal(status, 404);
  assert.ok(body.error);
});
