'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseEmail,
  parseAddress,
  extractDomain,
  extractLinks,
  extractAttachments,
} = require('../src/ruleEngine/parser');
const samples = require('./sampleEmails');

test('parseAddress: handles display name with angle brackets', () => {
  const r = parseAddress('"Microsoft Support" <noreply@host.ru>');
  assert.equal(r.displayName, 'Microsoft Support');
  assert.equal(r.address, 'noreply@host.ru');
  assert.equal(r.domain, 'host.ru');
});

test('parseAddress: handles a bare address', () => {
  const r = parseAddress('plain@example.com');
  assert.equal(r.displayName, '');
  assert.equal(r.address, 'plain@example.com');
  assert.equal(r.domain, 'example.com');
});

test('parseAddress: empty input does not throw', () => {
  const r = parseAddress('');
  assert.deepEqual(r, { displayName: '', address: '', domain: '' });
});

test('extractDomain: lowercases and strips trailing punctuation', () => {
  assert.equal(extractDomain('User@Example.COM'), 'example.com');
  assert.equal(extractDomain('a@b.com>'), 'b.com');
  assert.equal(extractDomain('no-at-sign'), '');
});

test('extractLinks: captures HTML anchors with text and href', () => {
  const links = extractLinks('<a href="http://evil.com/x">https://good.com</a>');
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'http://evil.com/x');
  assert.equal(links[0].text, 'https://good.com');
  assert.equal(links[0].isAnchor, true);
});

test('extractLinks: captures bare URLs in plain text', () => {
  const links = extractLinks('visit https://example.com/page now');
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'https://example.com/page');
  assert.equal(links[0].isAnchor, false);
});

test('extractAttachments: finds declared filenames', () => {
  const atts = extractAttachments('Content-Disposition: attachment; filename="invoice.pdf.exe"');
  assert.equal(atts.length, 1);
  assert.equal(atts[0].filename, 'invoice.pdf.exe');
});

test('parseEmail: splits headers and body on a known phishing sample', () => {
  const email = parseEmail(samples.phishingPaypal);
  assert.equal(email.from.displayName, 'PayPal Service');
  assert.equal(email.from.domain, 'paypa1-secure.com');
  assert.match(email.subject, /verify immediately/i);
  assert.ok(email.body.includes('unusual activity'));
  assert.ok(email.links.length >= 1);
});

test('parseEmail: tolerates a body-only input with no headers', () => {
  const email = parseEmail('just some text with no headers at all');
  assert.equal(email.from.address, '');
  assert.ok(email.body.includes('just some text'));
});

test('parseEmail: null input does not throw', () => {
  const email = parseEmail(null);
  assert.equal(email.raw, '');
  assert.equal(email.subject, '');
});

test('parseEmail: handles folded (continuation) headers', () => {
  const raw = 'Subject: a very long\n subject line folded\nFrom: x@y.com\n\nbody';
  const email = parseEmail(raw);
  assert.equal(email.subject, 'a very long subject line folded');
});
