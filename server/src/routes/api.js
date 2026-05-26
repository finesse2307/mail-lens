'use strict';

/**
 * API routes.
 *
 *   POST /api/analyze        - analyze a raw email, save it, return the result
 *   GET  /api/analyses       - recent analyses for the history view
 *   GET  /api/analyses/:id   - one full analysis by id
 */

const express = require('express');
const { analyzeEmail } = require('../services/analysisService');
const { saveAnalysis, listAnalyses, getAnalysisById } = require('../services/db');

const router = express.Router();

/** Minimal server-side validation: present, a string, and email-ish. */
function validateEmailInput(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return 'Email text is required.';
  }
  if (value.length > 100000) {
    return 'Email text is too large (max 100 KB).';
  }
  // "Looks email-ish": either has header-style lines or a plausible address.
  const hasHeaders = /^[A-Za-z-]+:\s/m.test(value);
  const hasAddress = /[^\s@]+@[^\s@]+\.[^\s@]+/.test(value);
  if (!hasHeaders && !hasAddress) {
    return 'This does not look like an email (no headers or addresses found).';
  }
  return null;
}

// POST /api/analyze
router.post('/analyze', async (req, res) => {
  const rawEmail = req.body && req.body.email;
  const validationError = validateEmailInput(rawEmail);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  try {
    const analysis = await analyzeEmail(rawEmail);
    const saved = await saveAnalysis(analysis);
    return res.status(201).json(saved);
  } catch (err) {
    console.error('[analyze] unexpected failure:', err);
    return res.status(500).json({ error: 'Analysis failed unexpectedly.' });
  }
});

// GET /api/analyses
router.get('/analyses', async (_req, res) => {
  try {
    const analyses = await listAnalyses(25);
    return res.json(analyses);
  } catch (err) {
    console.error('[analyses] list failed:', err);
    return res.status(500).json({ error: 'Could not load analyses.' });
  }
});

// GET /api/analyses/:id
router.get('/analyses/:id', async (req, res) => {
  try {
    const analysis = await getAnalysisById(req.params.id);
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found.' });
    }
    return res.json(analysis);
  } catch (err) {
    console.error('[analyses] fetch failed:', err);
    return res.status(500).json({ error: 'Could not load analysis.' });
  }
});

module.exports = router;
