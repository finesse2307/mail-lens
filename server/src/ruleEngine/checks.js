'use strict';

/**
 * The deterministic checks.
 *
 * Every check is a pure function: it takes the parsed email and returns a
 * finding of the shape:
 *   { id, label, passed, severity, detail }
 *
 * `passed: true`  -> the check found nothing suspicious (good).
 * `passed: false` -> the check flagged something (bad).
 * `severity` is 'low' | 'medium' | 'high' and feeds the score merge.
 *
 * Keeping them independent and side-effect-free is what makes them unit
 * testable.
 */

/** A small list of commonly impersonated brands and their real domains. */
const KNOWN_BRANDS = [
  { name: 'paypal', domain: 'paypal.com' },
  { name: 'amazon', domain: 'amazon.com' },
  { name: 'google', domain: 'google.com' },
  { name: 'microsoft', domain: 'microsoft.com' },
  { name: 'apple', domain: 'apple.com' },
  { name: 'netflix', domain: 'netflix.com' },
  { name: 'facebook', domain: 'facebook.com' },
  { name: 'instagram', domain: 'instagram.com' },
  { name: 'chase', domain: 'chase.com' },
  { name: 'wellsfargo', domain: 'wellsfargo.com' },
  { name: 'bankofamerica', domain: 'bankofamerica.com' },
  { name: 'dhl', domain: 'dhl.com' },
  { name: 'fedex', domain: 'fedex.com' },
  { name: 'ups', domain: 'ups.com' },
  { name: 'linkedin', domain: 'linkedin.com' },
];

/** Risky attachment extensions that are unusual for legitimate mail. */
const RISKY_EXTENSIONS = [
  'exe', 'scr', 'js', 'jar', 'vbs', 'bat', 'cmd', 'com', 'pif',
  'msi', 'hta', 'ps1', 'lnk', 'iso', 'img',
];

/** Double extensions are a classic disguise (invoice.pdf.exe). */
const DOCUMENT_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'jpg', 'png'];

/** Urgency / pressure phrases scanned for in the body. */
const URGENCY_PHRASES = [
  'verify immediately', 'verify your account', 'account suspended',
  'account has been suspended', 'within 24 hours', 'within 48 hours',
  'act now', 'urgent action required', 'immediate action',
  'your account will be closed', 'confirm your identity',
  'unusual activity', 'suspicious activity', 'click here immediately',
  'failure to comply', 'limited time', 'final notice', 'last warning',
  'avoid suspension', 'update your payment', 'security alert',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pull a verdict (pass/fail/none) for a mechanism from Authentication-Results. */
function readAuthVerdict(authResults, mechanism) {
  if (!authResults) return null;
  const re = new RegExp(mechanism + '\\s*=\\s*(\\w+)', 'i');
  const match = authResults.match(re);
  return match ? match[1].toLowerCase() : null;
}

/** Levenshtein edit distance — used for lookalike-domain detection. */
function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

/** The registrable part of a host, roughly: last two labels. */
function registrableDomain(host) {
  if (!host) return '';
  const labels = host.toLowerCase().split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  return labels.slice(-2).join('.');
}

/** Get the host out of a URL string without throwing. */
function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    const m = String(url).match(/^[a-z]+:\/\/([^/:?#]+)/i);
    return m ? m[1].toLowerCase() : '';
  }
}

/** True if the host is a bare IPv4 address. */
function isIpHost(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

// ---------------------------------------------------------------------------
// Check 1: Header authentication (SPF / DKIM / DMARC)
// ---------------------------------------------------------------------------

function checkHeaderAuth(email) {
  const id = 'header-auth';
  const label = 'Email authentication (SPF / DKIM / DMARC)';

  const spf =
    readAuthVerdict(email.authResults, 'spf') ||
    (email.receivedSpf ? email.receivedSpf.trim().split(/\s+/)[0].toLowerCase() : null);
  const dkim = readAuthVerdict(email.authResults, 'dkim');
  const dmarc = readAuthVerdict(email.authResults, 'dmarc');

  if (spf === null && dkim === null && dmarc === null) {
    return {
      id, label, passed: true, severity: 'low',
      detail: 'No authentication headers present to evaluate (inconclusive).',
    };
  }

  const failed = [];
  if (spf && /^(fail|softfail|none)$/.test(spf)) failed.push('SPF=' + spf);
  if (dkim && /^(fail|none|invalid)$/.test(dkim)) failed.push('DKIM=' + dkim);
  if (dmarc && /^(fail|none)$/.test(dmarc)) failed.push('DMARC=' + dmarc);

  if (failed.length === 0) {
    return {
      id, label, passed: true, severity: 'low',
      detail: 'Authentication checks passed: ' +
        [spf && 'SPF', dkim && 'DKIM', dmarc && 'DMARC'].filter(Boolean).join(', ') + '.',
    };
  }
  return {
    id, label, passed: false,
    severity: failed.length >= 2 ? 'high' : 'medium',
    detail: 'Authentication failures detected: ' + failed.join(', ') + '.',
  };
}

// ---------------------------------------------------------------------------
// Check 2: Display-name spoofing
// ---------------------------------------------------------------------------

function checkDisplayNameSpoofing(email) {
  const id = 'display-name-spoof';
  const label = 'Display name vs. sender domain';
  const { displayName, domain } = email.from;

  if (!displayName || !domain) {
    return {
      id, label, passed: true, severity: 'low',
      detail: 'Not enough sender information to evaluate.',
    };
  }

  const nameLower = displayName.toLowerCase();
  const senderReg = registrableDomain(domain);

  // If the display name references a known brand, the sender domain should
  // plausibly belong to that brand.
  for (const brand of KNOWN_BRANDS) {
    if (nameLower.includes(brand.name)) {
      const brandReg = registrableDomain(brand.domain);
      if (senderReg !== brandReg && !senderReg.endsWith('.' + brandReg)) {
        return {
          id, label, passed: false, severity: 'high',
          detail: `Display name claims "${displayName}" but the message is sent ` +
            `from "${domain}", which is not a ${brand.name} domain.`,
        };
      }
    }
  }

  // The display name itself looks like an email address on a different domain.
  const nameAddrMatch = displayName.match(/@([A-Za-z0-9.-]+)/);
  if (nameAddrMatch) {
    const nameDomain = registrableDomain(nameAddrMatch[1]);
    if (nameDomain && nameDomain !== senderReg) {
      return {
        id, label, passed: false, severity: 'medium',
        detail: `Display name contains "${nameAddrMatch[1]}" but the real ` +
          `sender domain is "${domain}".`,
      };
    }
  }

  return {
    id, label, passed: true, severity: 'low',
    detail: 'Display name is consistent with the sender domain.',
  };
}

// ---------------------------------------------------------------------------
// Check 3: Lookalike domains
// ---------------------------------------------------------------------------

function checkLookalikeDomains(email) {
  const id = 'lookalike-domain';
  const label = 'Lookalike / typosquatted domains';

  const candidates = new Set();
  if (email.from.domain) candidates.add(email.from.domain);
  for (const link of email.links) {
    const h = hostOf(link.href);
    if (h && !isIpHost(h)) candidates.add(h);
  }

  const hits = [];
  for (const host of candidates) {
    const reg = registrableDomain(host);
    const namePart = reg.split('.')[0] || '';
    // Sub-tokens of a compound name: "paypa1-secure" -> ["paypa1", "secure"].
    const tokens = namePart.split(/[-_]/).filter(Boolean);
    const probeStrings = [namePart, ...tokens];

    for (const brand of KNOWN_BRANDS) {
      const brandReg = registrableDomain(brand.domain);
      if (reg === brandReg || reg.endsWith('.' + brandReg)) continue; // legit
      const brandName = brand.name;

      let matched = false;
      for (const probe of probeStrings) {
        if (probe === brandName) continue; // exact token, not a lookalike
        // Character-substitution / near-miss against the brand name.
        const dist = editDistance(probe, brandName);
        const looksClose =
          dist > 0 && dist <= 2 && probe.length >= brandName.length - 1 &&
          probe.length <= brandName.length + 1;
        // Brand name embedded in a larger unrelated token.
        const embedded =
          probe !== brandName && probe.includes(brandName) &&
          probe.length > brandName.length;
        if (looksClose || embedded) {
          matched = true;
          break;
        }
      }
      if (matched) {
        hits.push(`"${host}" resembles ${brand.name} (${brand.domain})`);
        break;
      }
    }
  }

  if (hits.length === 0) {
    return {
      id, label, passed: true, severity: 'low',
      detail: 'No lookalike domains detected among sender or links.',
    };
  }
  return {
    id, label, passed: false, severity: 'high',
    detail: 'Possible impersonation: ' + hits.join('; ') + '.',
  };
}

// ---------------------------------------------------------------------------
// Check 4: URL analysis
// ---------------------------------------------------------------------------

function checkUrlAnalysis(email) {
  const id = 'url-analysis';
  const label = 'Link inspection';

  if (email.links.length === 0) {
    return {
      id, label, passed: true, severity: 'low',
      detail: 'No links found in the message body.',
    };
  }

  const problems = [];
  for (const link of email.links) {
    const host = hostOf(link.href);

    if (isIpHost(host)) {
      problems.push(`raw IP-address URL (${host})`);
      continue;
    }

    // Mismatch between visible text and actual destination — but only when
    // the visible text is itself URL-like (otherwise "click here" is fine).
    const textLooksLikeUrl = /^(https?:\/\/|www\.)/i.test(link.text) ||
      /\.[a-z]{2,}\//i.test(link.text);
    if (link.isAnchor && textLooksLikeUrl) {
      const textHost = hostOf(
        /^https?:\/\//i.test(link.text) ? link.text : 'http://' + link.text
      );
      if (textHost && host && registrableDomain(textHost) !== registrableDomain(host)) {
        problems.push(
          `link text shows "${textHost}" but actually points to "${host}"`
        );
      }
    }
  }

  if (problems.length === 0) {
    return {
      id, label, passed: true, severity: 'low',
      detail: `Inspected ${email.links.length} link(s); nothing suspicious.`,
    };
  }
  return {
    id, label, passed: false,
    severity: problems.length >= 2 ? 'high' : 'medium',
    detail: 'Suspicious links: ' + problems.join('; ') + '.',
  };
}

// ---------------------------------------------------------------------------
// Check 5: Urgency / pressure language
// ---------------------------------------------------------------------------

function checkUrgencyLanguage(email) {
  const id = 'urgency-language';
  const label = 'Urgency / pressure language';

  const haystack = (email.subject + '\n' + email.body).toLowerCase();
  const found = URGENCY_PHRASES.filter((p) => haystack.includes(p));

  if (found.length === 0) {
    return {
      id, label, passed: true, severity: 'low',
      detail: 'No common pressure or urgency phrasing detected.',
    };
  }
  return {
    id, label, passed: false,
    severity: found.length >= 3 ? 'high' : found.length === 2 ? 'medium' : 'low',
    detail: `Found ${found.length} pressure phrase(s): ` +
      found.slice(0, 5).map((p) => `"${p}"`).join(', ') + '.',
  };
}

// ---------------------------------------------------------------------------
// Check 6: Attachment red flags
// ---------------------------------------------------------------------------

function checkAttachments(email) {
  const id = 'attachment-flags';
  const label = 'Attachment red flags';

  if (!email.attachments || email.attachments.length === 0) {
    return {
      id, label, passed: true, severity: 'low',
      detail: 'No attachments declared in the message.',
    };
  }

  const problems = [];
  for (const att of email.attachments) {
    const name = String(att.filename || '').toLowerCase();
    const parts = name.split('.').filter(Boolean);
    const ext = parts[parts.length - 1] || '';

    if (RISKY_EXTENSIONS.includes(ext)) {
      problems.push(`"${att.filename}" has a risky .${ext} extension`);
    }
    // Double extension: invoice.pdf.exe
    if (parts.length >= 3) {
      const secondLast = parts[parts.length - 2];
      if (DOCUMENT_EXTENSIONS.includes(secondLast) && RISKY_EXTENSIONS.includes(ext)) {
        problems.push(`"${att.filename}" uses a disguised double extension`);
      }
    }
  }

  if (problems.length === 0) {
    return {
      id, label, passed: true, severity: 'low',
      detail: `Declared ${email.attachments.length} attachment(s); no risky types.`,
    };
  }
  return {
    id, label, passed: false, severity: 'high',
    detail: 'Risky attachments: ' + problems.join('; ') + '.',
  };
}

module.exports = {
  KNOWN_BRANDS,
  RISKY_EXTENSIONS,
  URGENCY_PHRASES,
  editDistance,
  registrableDomain,
  hostOf,
  isIpHost,
  checkHeaderAuth,
  checkDisplayNameSpoofing,
  checkLookalikeDomains,
  checkUrlAnalysis,
  checkUrgencyLanguage,
  checkAttachments,
};
