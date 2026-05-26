'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEmail } = require('../src/ruleEngine/parser');
const {
  editDistance,
  registrableDomain,
  isIpHost,
  checkHeaderAuth,
  checkDisplayNameSpoofing,
  checkLookalikeDomains,
  checkUrlAnalysis,
  checkUrgencyLanguage,
  checkAttachments,
} = require('../src/ruleEngine/checks');
const { runRuleEngine } = require('../src/ruleEngine');
const samples = require('./sampleEmails');

// --- helpers --------------------------------------------------------------

test('editDistance: basic cases', () => {
  assert.equal(editDistance('paypal', 'paypal'), 0);
  assert.equal(editDistance('paypal', 'paypa1'), 1);
  assert.equal(editDistance('google', 'g00gle'), 2);
});

test('registrableDomain: reduces to last two labels', () => {
  assert.equal(registrableDomain('mail.google.com'), 'google.com');
  assert.equal(registrableDomain('paypal.com'), 'paypal.com');
});

test('isIpHost: detects bare IPv4 hosts', () => {
  assert.equal(isIpHost('203.0.113.45'), true);
  assert.equal(isIpHost('example.com'), false);
});

// --- check 1: header auth -------------------------------------------------

test('checkHeaderAuth: flags SPF + DMARC failures', () => {
  const f = checkHeaderAuth(parseEmail(samples.phishingPaypal));
  assert.equal(f.passed, false);
  assert.equal(f.severity, 'high');
});

test('checkHeaderAuth: passes when all mechanisms pass', () => {
  const f = checkHeaderAuth(parseEmail(samples.legitGithub));
  assert.equal(f.passed, true);
});

test('checkHeaderAuth: inconclusive when no auth headers present', () => {
  const f = checkHeaderAuth(parseEmail('From: a@b.com\n\nhello'));
  assert.equal(f.passed, true);
  assert.match(f.detail, /inconclusive/i);
});

// --- check 2: display-name spoofing --------------------------------------

test('checkDisplayNameSpoofing: flags brand name on wrong domain', () => {
  const f = checkDisplayNameSpoofing(parseEmail(samples.phishingMicrosoft));
  assert.equal(f.passed, false);
  assert.equal(f.severity, 'high');
});

test('checkDisplayNameSpoofing: passes for a legit GitHub email', () => {
  const f = checkDisplayNameSpoofing(parseEmail(samples.legitGithub));
  assert.equal(f.passed, true);
});

// --- check 3: lookalike domains ------------------------------------------

test('checkLookalikeDomains: flags paypa1-secure.com as a PayPal lookalike', () => {
  const f = checkLookalikeDomains(parseEmail(samples.phishingPaypal));
  assert.equal(f.passed, false);
  assert.match(f.detail, /paypal/i);
});

test('checkLookalikeDomains: does not flag the real github.com', () => {
  const f = checkLookalikeDomains(parseEmail(samples.legitGithub));
  assert.equal(f.passed, true);
});

// --- check 4: URL analysis -----------------------------------------------

test('checkUrlAnalysis: flags raw IP URL and text/href mismatch', () => {
  const f = checkUrlAnalysis(parseEmail(samples.phishingPaypal));
  assert.equal(f.passed, false);
  assert.match(f.detail, /IP-address/i);
});

test('checkUrlAnalysis: passes for a normal "Read more" link', () => {
  const f = checkUrlAnalysis(parseEmail(samples.legitNewsletter));
  assert.equal(f.passed, true);
});

// --- check 5: urgency language -------------------------------------------

test('checkUrgencyLanguage: flags multiple pressure phrases', () => {
  const f = checkUrgencyLanguage(parseEmail(samples.phishingPaypal));
  assert.equal(f.passed, false);
  assert.equal(f.severity, 'high');
});

test('checkUrgencyLanguage: passes for a calm legit email', () => {
  const f = checkUrgencyLanguage(parseEmail(samples.legitGithub));
  assert.equal(f.passed, true);
});

// --- check 6: attachments -------------------------------------------------

test('checkAttachments: flags a disguised double extension', () => {
  const f = checkAttachments(parseEmail(samples.phishingAttachment));
  assert.equal(f.passed, false);
  assert.equal(f.severity, 'high');
  assert.match(f.detail, /double extension/i);
});

test('checkAttachments: passes when there are no attachments', () => {
  const f = checkAttachments(parseEmail(samples.legitGithub));
  assert.equal(f.passed, true);
});

// --- orchestrator ---------------------------------------------------------

test('runRuleEngine: phishing email yields a high baseline score', () => {
  const r = runRuleEngine(samples.phishingPaypal);
  assert.ok(r.baselineScore >= 70, `expected >=70, got ${r.baselineScore}`);
  assert.equal(r.baselineCategory, 'high');
  assert.ok(r.highSeverityCount >= 2);
  assert.equal(r.findings.length, 6);
});

test('runRuleEngine: legit email yields a low/minimal score', () => {
  const r = runRuleEngine(samples.legitGithub);
  assert.ok(r.baselineScore < 15, `expected <15, got ${r.baselineScore}`);
  assert.equal(r.failedCount, 0);
});

test('runRuleEngine: always returns six findings even for junk input', () => {
  const r = runRuleEngine('');
  assert.equal(r.findings.length, 6);
  assert.equal(typeof r.baselineScore, 'number');
});
