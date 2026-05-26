/**
 * RuleFindingsList — renders the deterministic rule-engine findings as a
 * pass/fail checklist. Each finding shows its label, severity, and detail.
 */
export default function RuleFindingsList({ findings }) {
  if (!findings || findings.length === 0) {
    return <p className="hint">No rule findings.</p>;
  }

  return (
    <div className="findings">
      {findings.map((f) => (
        <div className="finding" key={f.id}>
          <div className={`finding-icon ${f.passed ? 'pass' : 'fail'}`}>
            {f.passed ? '✓' : '!'}
          </div>
          <div>
            <div className="finding-label">
              {f.label}
              {!f.passed && <span className={`sev ${f.severity}`}>{f.severity}</span>}
            </div>
            <div className="finding-detail">{f.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
