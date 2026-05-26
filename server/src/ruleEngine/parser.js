'use strict';

/**
 * Email parser.
 *
 * Takes a raw email (headers + body, RFC-822-ish) and produces a structured
 * object the rule-engine checks can operate on. This is deliberately
 * tolerant: pasted emails are messy, so we extract what we can and never
 * throw on malformed input.
 */

/**
 * Split a raw email into its header block and body.
 * The first blank line separates headers from body.
 */
function splitHeadersAndBody(raw) {
  const normalized = String(raw).replace(/\r\n/g, '\n');
  const separatorIndex = normalized.indexOf('\n\n');
  if (separatorIndex === -1) {
    // No blank line: treat the whole thing as body if it has no header-ish
    // lines, otherwise treat it all as headers.
    const looksLikeHeaders = /^[A-Za-z-]+:\s/m.test(normalized);
    return looksLikeHeaders
      ? { headerBlock: normalized, body: '' }
      : { headerBlock: '', body: normalized };
  }
  return {
    headerBlock: normalized.slice(0, separatorIndex),
    body: normalized.slice(separatorIndex + 2),
  };
}

/**
 * Parse a header block into a case-insensitive map.
 * Handles folded headers (continuation lines starting with whitespace).
 */
function parseHeaders(headerBlock) {
  const headers = {};
  if (!headerBlock) return headers;

  const lines = headerBlock.split('\n');
  let currentKey = null;

  for (const line of lines) {
    if (/^\s/.test(line) && currentKey) {
      // Folded continuation of the previous header.
      headers[currentKey] += ' ' + line.trim();
      continue;
    }
    const match = line.match(/^([A-Za-z0-9-]+):\s?(.*)$/);
    if (match) {
      currentKey = match[1].toLowerCase();
      // If a header repeats, keep them joined (e.g. multiple Received lines).
      headers[currentKey] = headers[currentKey]
        ? headers[currentKey] + '\n' + match[2]
        : match[2];
    }
  }
  return headers;
}

/**
 * Pull a display name and email address out of a "From"-style header value.
 * Handles:  "Microsoft Support" <noreply@host.ru>
 *           noreply@host.ru
 *           Microsoft Support <noreply@host.ru>
 */
function parseAddress(headerValue) {
  if (!headerValue) {
    return { displayName: '', address: '', domain: '' };
  }
  const value = headerValue.trim();

  const angleMatch = value.match(/^(.*?)<([^>]+)>\s*$/);
  let displayName = '';
  let address = '';

  if (angleMatch) {
    displayName = angleMatch[1].trim().replace(/^["']|["']$/g, '').trim();
    address = angleMatch[2].trim();
  } else {
    // Bare address with no angle brackets.
    address = value.replace(/^["']|["']$/g, '').trim();
  }

  const domain = extractDomain(address);
  return { displayName, address, domain };
}

/** Get the domain portion of an email address, lowercased. */
function extractDomain(address) {
  if (!address) return '';
  const at = address.lastIndexOf('@');
  if (at === -1) return '';
  return address.slice(at + 1).trim().toLowerCase().replace(/[>,;]+$/, '');
}

/**
 * Extract links from the body. Catches both:
 *  - HTML anchors:  <a href="real">visible text</a>
 *  - Bare URLs in plain text
 * Each link records the href and the visible text (when known).
 */
function extractLinks(body) {
  const links = [];
  if (!body) return links;

  // HTML anchors first.
  const anchorRegex = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;
  let m;
  while ((m = anchorRegex.exec(body)) !== null) {
    const href = m[1].trim();
    const visibleText = m[2].replace(/<[^>]+>/g, '').trim();
    links.push({ href, text: visibleText, isAnchor: true });
  }

  // Bare URLs in plain text. Strip out anchor tags first so URLs that appear
  // as an anchor's href or visible text are not counted a second time.
  const withoutAnchors = body.replace(anchorRegex, ' ');
  const urlRegex = /\bhttps?:\/\/[^\s"'<>)]+/gi;
  while ((m = urlRegex.exec(withoutAnchors)) !== null) {
    const url = m[0];
    links.push({ href: url, text: url, isAnchor: false });
  }
  return links;
}

/**
 * Detect declared attachments. Real attachment parsing needs full MIME
 * decoding; for pasted emails we look for Content-Disposition lines and
 * common "filename=" markers.
 */
function extractAttachments(raw) {
  const attachments = [];
  const normalized = String(raw).replace(/\r\n/g, '\n');
  const filenameRegex = /filename\s*=\s*["']?([^"'\n;]+)["']?/gi;
  let m;
  while ((m = filenameRegex.exec(normalized)) !== null) {
    const filename = m[1].trim();
    if (filename) {
      attachments.push({ filename });
    }
  }
  return attachments;
}

/**
 * Main entry point. Returns a structured representation of the email.
 */
function parseEmail(raw) {
  const safeRaw = raw == null ? '' : String(raw);
  const { headerBlock, body } = splitHeadersAndBody(safeRaw);
  const headers = parseHeaders(headerBlock);

  const from = parseAddress(headers['from']);
  const replyTo = parseAddress(headers['reply-to']);
  const returnPath = parseAddress(headers['return-path']);

  return {
    raw: safeRaw,
    headers,
    subject: headers['subject'] || '',
    from,
    replyTo,
    returnPath,
    body,
    links: extractLinks(body),
    attachments: extractAttachments(safeRaw),
    // Authentication-Results is where SPF/DKIM/DMARC verdicts usually live.
    authResults: headers['authentication-results'] || '',
    receivedSpf: headers['received-spf'] || '',
  };
}

module.exports = {
  parseEmail,
  splitHeadersAndBody,
  parseHeaders,
  parseAddress,
  extractDomain,
  extractLinks,
  extractAttachments,
};
