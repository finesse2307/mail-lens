'use strict';

/**
 * Sample emails used by the unit tests. A mix of phishing and legitimate
 * messages so checks can be verified to both fire and stay quiet.
 */

// A blatant PayPal phishing attempt: display-name spoof, lookalike domain,
// urgency language, link mismatch, SPF/DMARC failure.
const phishingPaypal = [
  'From: "PayPal Service" <security@paypa1-secure.com>',
  'To: victim@example.com',
  'Subject: Your account has been suspended - verify immediately',
  'Authentication-Results: mx.example.com; spf=fail; dkim=none; dmarc=fail',
  'Content-Type: text/html',
  '',
  '<p>Dear customer, we detected unusual activity on your account.</p>',
  '<p>Your account has been suspended. You must verify immediately ',
  'within 24 hours or your account will be closed.</p>',
  '<p><a href="http://203.0.113.45/paypal/login">https://www.paypal.com/login</a></p>',
].join('\n');

// Microsoft display-name spoof from an unrelated domain.
const phishingMicrosoft = [
  'From: "Microsoft Support" <noreply@random-host.ru>',
  'To: victim@example.com',
  'Subject: Security alert: unusual activity detected',
  'Authentication-Results: mx.example.com; spf=softfail; dmarc=fail',
  '',
  'We noticed a suspicious activity. Please confirm your identity.',
  'Failure to comply will result in account suspension.',
].join('\n');

// Risky attachment with a disguised double extension.
const phishingAttachment = [
  'From: "Accounts Payable" <billing@invoices-online.biz>',
  'To: victim@example.com',
  'Subject: Outstanding invoice',
  'Content-Type: multipart/mixed; boundary=xyz',
  '',
  'Please find the attached invoice.',
  '',
  '--xyz',
  'Content-Disposition: attachment; filename="invoice.pdf.exe"',
  '--xyz--',
].join('\n');

// A clean, legitimate email: real domain, passing auth, no pressure.
const legitGithub = [
  'From: "GitHub" <noreply@github.com>',
  'To: user@example.com',
  'Subject: [GitHub] A new SSH key was added to your account',
  'Authentication-Results: mx.example.com; spf=pass; dkim=pass; dmarc=pass',
  '',
  'Hi there,',
  'A new SSH key was added to your account. If this was you, no action is needed.',
  'Visit https://github.com/settings/keys to review your keys.',
].join('\n');

// Legitimate newsletter with a normal "click here" link (text not URL-like).
const legitNewsletter = [
  'From: "Acme Weekly" <news@acme-corp.com>',
  'To: user@example.com',
  'Subject: Your weekly digest',
  'Authentication-Results: mx.example.com; spf=pass; dkim=pass; dmarc=pass',
  'Content-Type: text/html',
  '',
  '<p>Here is what happened this week.</p>',
  '<p><a href="https://acme-corp.com/digest">Read more</a></p>',
].join('\n');

module.exports = {
  phishingPaypal,
  phishingMicrosoft,
  phishingAttachment,
  legitGithub,
  legitNewsletter,
};
