'use strict';

/**
 * Rule engine orchestrator.
 *
 * Runs every deterministic check against a parsed email, collects the
 * findings, and derives a baseline risk score purely from rule severity.
 * No AI involved here — this module always returns a result, which is what
 * lets the app degrade gracefully when the LLM call fails.
 */

const { parseEmail } = require('./parser');
const {
  checkHeaderAuth,
  checkDisplayNameSpoofing,
  checkLookalikeDomains,
  checkUrlAnalysis,
  checkUrgencyLanguage,
  checkAttachments,
} = require('./checks');

const ALL_CHECKS = [
  checkHeaderAuth,
  checkDisplayNameSpoofing,
  checkLookalikeDomains,
  checkUrlAnalysis,
  checkUrgencyLanguage,
  checkAttachments,
];

/** Points a failed check contributes to the baseline score, by severity. */
const SEVERITY_WEIGHT = { low: 10, medium: 25, high: 40 };

/**
 * Turn a numeric score into a coarse category.
 * Kept here so rules-only results and merged results categorize the same way.
 */
function scoreToCategory(score) {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  if (score >= 15) return 'low';
  return 'minimal';
}

/**
 * Run the rule engine.
 *
 * @param {string} rawEmail - the raw pasted email
 * @returns {{
 *   parsed: object,
 *   findings: Array<object>,
 *   baselineScore: number,
 *   baselineCategory: string,
 *   failedCount: number,
 *   highSeverityCount: number
 * }}
 */
function runRuleEngine(rawEmail) {
  const parsed = parseEmail(rawEmail);

  const findings = ALL_CHECKS.map((check) => {
    try {
      return check(parsed);
    } catch (err) {
      // A bug in one check must never sink the whole analysis.
      return {
        id: check.name || 'unknown-check',
        label: 'Check failed to run',
        passed: true,
        severity: 'low',
        detail: 'This check could not be evaluated: ' + err.message,
      };
    }
  });

  const failed = findings.filter((f) => !f.passed);
  const rawScore = failed.reduce(
    (sum, f) => sum + (SEVERITY_WEIGHT[f.severity] || 0),
    0
  );
  const baselineScore = Math.min(100, rawScore);

  return {
    parsed,
    findings,
    baselineScore,
    baselineCategory: scoreToCategory(baselineScore),
    failedCount: failed.length,
    highSeverityCount: failed.filter((f) => f.severity === 'high').length,
  };
}

module.exports = { runRuleEngine, scoreToCategory, SEVERITY_WEIGHT };
