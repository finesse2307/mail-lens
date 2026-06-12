/**
 * apiClient.js
 *
 * Thin wrapper around fetch for the backend's API routes. Keeps fetch
 * boilerplate and error handling in one place so components stay clean.
 */

const BASE = '/api';

/**
 * Send cookies (the session cookie in particular) on every request.
 * 'same-origin' is the right setting because the React app is served by
 * the same Express server that hosts the API — they share an origin.
 */
const FETCH_OPTIONS = { credentials: 'same-origin' };

async function handle(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = (payload && payload.error) || `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload;
}

export async function analyzeEmail(rawEmail) {
  const response = await fetch(`${BASE}/analyze`, {
    ...FETCH_OPTIONS,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: rawEmail }),
  });
  return handle(response);
}

export async function fetchAnalyses() {
  return handle(await fetch(`${BASE}/analyses`, FETCH_OPTIONS));
}

export async function fetchAnalysisById(id) {
  return handle(
    await fetch(`${BASE}/analyses/${encodeURIComponent(id)}`, FETCH_OPTIONS)
  );
}