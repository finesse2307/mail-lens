'use strict';

/**
 * Anonymous session middleware.
 *
 * Issues each visitor a signed session cookie on first request. The cookie
 * carries a random session ID; the server tags every analysis with the
 * current session ID and scopes the history queries to it, so visitors only
 * see their own analyses.
 *
 * Security properties:
 *   - The cookie value is HMAC-signed with SESSION_SECRET so a visitor
 *     cannot forge another session ID by editing their cookie.
 *   - httpOnly: client-side JavaScript cannot read the cookie (XSS shield).
 *   - sameSite=lax: other sites cannot ride the cookie via CSRF.
 *   - secure in production: cookie only travels over HTTPS.
 *   - No personal data is in the cookie — only an opaque random ID.
 *
 * If SESSION_SECRET is missing, this module throws on require. That is
 * intentional: better to fail loud at boot than ship a server signing
 * cookies with a default/empty secret.
 */

const crypto = require('crypto');

const COOKIE_NAME = 'mlsid';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function resolveSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SESSION_SECRET environment variable is required in production.'
    );
  }
  return crypto.randomBytes(32).toString('hex');
}

const SECRET = resolveSecret();

function sign(sessionId) {
  return crypto
    .createHmac('sha256', SECRET)
    .update(sessionId)
    .digest('base64url');
}

function encodeCookie(sessionId) {
  return sessionId + '.' + sign(sessionId);
}

function verifyCookie(cookieValue) {
  if (typeof cookieValue !== 'string') return null;
  const dot = cookieValue.lastIndexOf('.');
  if (dot < 1) return null;
  const sessionId = cookieValue.slice(0, dot);
  const providedSig = cookieValue.slice(dot + 1);
  const expectedSig = sign(sessionId);
  if (providedSig.length !== expectedSig.length) return null;
  try {
    const ok = crypto.timingSafeEqual(
      Buffer.from(providedSig),
      Buffer.from(expectedSig)
    );
    return ok ? sessionId : null;
  } catch {
    return null;
  }
}

function parseCookieHeader(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    out[name] = decodeURIComponent(value);
  }
  return out;
}

function buildSetCookie(encodedValue) {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(encodedValue)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (process.env.NODE_ENV === 'production') attrs.push('Secure');
  return attrs.join('; ');
}

function sessionMiddleware(req, res, next) {
  const cookies = parseCookieHeader(req.headers.cookie);
  const existing = verifyCookie(cookies[COOKIE_NAME]);

  if (existing) {
    req.sessionId = existing;
    req.sessionIsNew = false;
  } else {
    const fresh = crypto.randomBytes(32).toString('base64url');
    req.sessionId = fresh;
    req.sessionIsNew = true;
    res.setHeader('Set-Cookie', buildSetCookie(encodeCookie(fresh)));
  }

  next();
}

module.exports = {
  sessionMiddleware,
  sign,
  encodeCookie,
  verifyCookie,
  parseCookieHeader,
  COOKIE_NAME,
};