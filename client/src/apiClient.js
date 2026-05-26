/**
 * apiClient.js
 *
 * Thin wrapper around fetch for the backend's API routes. Keeps fetch
 * boilerplate and error handling in one place so components stay clean.
 */

const BASE = '/api';

/** Parse a JSON response, surfacing the server's error message on failure. */
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

/** POST /api/analyze — analyze a raw email. */
export async function analyzeEmail(rawEmail) {
  const response = await fetch(`${BASE}/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: rawEmail }),
  });
  return handle(response);
}

/** GET /api/analyses — recent analyses for the history view. */
export async function fetchAnalyses() {
  return handle(await fetch(`${BASE}/analyses`));
}

/** GET /api/analyses/:id — one full analysis. */
export async function fetchAnalysisById(id) {
  return handle(await fetch(`${BASE}/analyses/${encodeURIComponent(id)}`));
}
