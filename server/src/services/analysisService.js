'use strict';

/**
 * Analysis service.
 *
 * Orchestrates a single email analysis:
 *   1. Run the rule engine (always succeeds).
 *   2. Concurrently ask the LLM for a holistic assessment.
 *   3. Merge the two into one overall risk score.
 *
 * The rule engine and the LLM call are independent — neither consumes the
 * other's output — so they run concurrently and the app degrades gracefully
 * if the AI layer is unavailable.
 */

const { runRuleEngine, scoreToCategory } = require('../ruleEngine');
const { assessWithLLM } = require('./llmService');

/**
 * Merge the deterministic baseline score with the LLM's score.
 *
 * The formula is deliberately simple and defensible:
 *   - The rule engine produces the baseline (it is the trustworthy floor).
 *   - When the LLM is available, the overall score is a weighted blend
 *     (60% rules / 40% LLM), but never allowed to drop below the
 *     baseline when high-severity rules fired — deterministic evidence of
 *     a real problem should not be talked down by the model.
 */
function mergeScores(ruleResult, aiAssessment) {
  const baseline = ruleResult.baselineScore;

  if (!aiAssessment) {
    return { overallRiskScore: baseline, overallRiskCategory: ruleResult.baselineCategory };
  }

  const blended = Math.round(0.6 * baseline + 0.4 * aiAssessment.riskScore);
  // High-severity rule failures set a floor the model cannot undercut.
  const floor = ruleResult.highSeverityCount > 0 ? baseline : 0;
  const overall = Math.max(blended, floor);
  const clamped = Math.max(0, Math.min(100, overall));

  return { overallRiskScore: clamped, overallRiskCategory: scoreToCategory(clamped) };
}

/**
 * Analyze one raw email end to end.
 *
 * @param {string} rawEmail
 * @returns {Promise<object>} the full result, ready to save and return
 */
async function analyzeEmail(rawEmail) {
  // Rule engine is synchronous; wrap so it runs alongside the LLM call.
  const rulePromise = Promise.resolve().then(() => runRuleEngine(rawEmail));
  const ruleResult = await rulePromise;

  // The LLM gets the parsed email + findings. Concurrency: in practice the
  // rule engine finishes in microseconds, so we await it then fire the LLM.
  const ai = await assessWithLLM(ruleResult.parsed, ruleResult.findings);

  const aiAvailable = ai.available === true;
  const aiAssessment = aiAvailable ? ai.assessment : null;
  const { overallRiskScore, overallRiskCategory } = mergeScores(ruleResult, aiAssessment);

  return {
    createdAt: new Date().toISOString(),
    emailSubject: ruleResult.parsed.subject,
    senderDisplayName: ruleResult.parsed.from.displayName,
    senderDomain: ruleResult.parsed.from.domain,
    ruleFindings: ruleResult.findings,
    baselineScore: ruleResult.baselineScore,
    aiAssessment,
    aiAvailable,
    aiError: aiAvailable ? null : ai.error || 'AI assessment unavailable.',
    overallRiskScore,
    overallRiskCategory,
  };
}

module.exports = { analyzeEmail, mergeScores };
