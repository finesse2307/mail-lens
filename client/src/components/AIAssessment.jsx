/**
 * AIAssessment — renders the LLM's holistic assessment: reasoning and the
 * social-engineering tactics it spotted. When the AI layer was unavailable,
 * it shows a clear "graceful degradation" notice instead.
 */
export default function AIAssessment({ assessment, available, error }) {
  if (!available || !assessment) {
    return (
      <div className="ai-unavailable">
        <strong>AI assessment unavailable.</strong> The rule engine result
        above stands on its own — this analysis degraded gracefully.
        {error ? <div style={{ marginTop: 8 }}>Reason: {error}</div> : null}
      </div>
    );
  }

  return (
    <div>
      <p className="ai-reasoning">{assessment.reasoning}</p>
      {assessment.tacticsObserved && assessment.tacticsObserved.length > 0 && (
        <div className="tactics">
          {assessment.tacticsObserved.map((t, i) => (
            <span className="tactic" key={i}>{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}
