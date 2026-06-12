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
 *
 * Session isolation is exercised via cookie-aware helpers: passing the same
 * `jar` across calls simulates one visitor's browser; a fresh jar simulates
 * a different visitor.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const samples = require('./sampleEmails');

let server;
let baseUrl;

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

/**
 * Cookie-aware HTTP helpers.
 *
 * Each call accepts an optional `jar` (a plain object that accumulates the
 * Set-Cookie header value). Passing the same jar across requests simulates
 * a single visitor's browser session; passing a fresh jar simulates a
 * different visitor.
 */
function captureSetCookie(res, jar) {
  if (!jar) return;
  const sc = res.headers.get('set-cookie');
  if (sc) jar.cookie = sc.split(';')[0]; // keep just "name=value"
}

async function postJson(pathName, payload, jar) {
  const headers = { 'content-type': 'application/json' };
  if (jar && jar.cookie) headers.cookie = jar.cookie;
  const res = await fetch(baseUrl + pathName, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  captureSetCookie(res, jar);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function getJson(pathName, jar) {
  const headers = {};
  if (jar && jar.cookie) headers.cookie = jar.cookie;
  const res = await fetch(baseUrl + pathName, { headers });
  captureSetCookie(res, jar);
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

test('GET /api/analyses: lists THIS session\'s analyses, newest first', async () => {
  const jar = {};
  await postJson('/api/analyze', { email: samples.phishingMicrosoft }, jar);
  await postJson('/api/analyze', { email: samples.legitNewsletter }, jar);

  const { status, body } = await getJson('/api/analyses', jar);
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  assert.ok(body.length >= 2);
  assert.ok('overallRiskScore' in body[0]);
  assert.ok('emailSubject' in body[0]);
});

test('GET /api/analyses: a brand-new session sees an empty list', async () => {
  // First, another session creates some analyses.
  const otherJar = {};
  await postJson('/api/analyze', { email: samples.phishingPaypal }, otherJar);

  // A fresh visitor (no cookies sent yet -> gets a brand-new cookie back).
  const freshJar = {};
  const { status, body } = await getJson('/api/analyses', freshJar);
  assert.equal(status, 200);
  assert.deepEqual(body, [], 'new session must not see other sessions\' data');
});

// --- GET /api/analyses/:id -------------------------------------------------

test('GET /api/analyses/:id: returns the analysis to its own session', async () => {
  const jar = {};
  const created = await postJson('/api/analyze', { email: samples.phishingPaypal }, jar);
  const id = created.body._id;

  const { status, body } = await getJson('/api/analyses/' + id, jar);
  assert.equal(status, 200);
  assert.equal(body._id, id);
  assert.equal(body.ruleFindings.length, 6);
});

test('GET /api/analyses/:id: returns 404 for another session\'s analysis', async () => {
  // Session A creates an analysis and gets its real id.
  const jarA = {};
  const created = await postJson('/api/analyze', { email: samples.phishingPaypal }, jarA);
  const id = created.body._id;

  // Session B tries to read it.
  const jarB = {};
  const { status } = await getJson('/api/analyses/' + id, jarB);
  // 404 (not 403) so the API cannot be used to enumerate other sessions' IDs.
  assert.equal(status, 404);
});

test('Tampered session cookie is rejected and a fresh session is issued', async () => {
  // Visitor A creates an analysis, gets a real signed cookie.
  const jarA = {};
  await postJson('/api/analyze', { email: samples.phishingPaypal }, jarA);
  const realCookie = jarA.cookie;
  assert.ok(realCookie, 'real cookie was set');

  // Visitor T tampers with the cookie value while keeping the cookie name.
  // We flip the last few chars of the value — the signature no longer matches.
  const [name, value] = realCookie.split('=');
  const tampered = name + '=' + value.slice(0, -4) + 'AAAA';
  const tamperedJar = { cookie: tampered };

  // The list should be empty for the tampered visitor (fresh session issued).
  const { status, body } = await getJson('/api/analyses', tamperedJar);
  assert.equal(status, 200);
  assert.deepEqual(body, [], 'tampered cookie must not access another session');
});

test('GET /api/analyses/:id: unknown id returns 404', async () => {
  const { status, body } = await getJson('/api/analyses/does-not-exist');
  assert.equal(status, 404);
  assert.ok(body.error);
});