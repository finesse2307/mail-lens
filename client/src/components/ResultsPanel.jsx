import RuleFindingsList from './RuleFindingsList';
import AIAssessment from './AIAssessment';

/** Map a risk category to its CSS color variable. */
const CATEGORY_COLOR = {
  high: 'var(--risk-high)',
  medium: 'var(--risk-medium)',
  low: 'var(--risk-low)',
  minimal: 'var(--risk-minimal)',
};

/** Circular SVG risk gauge — an arc filled in proportion to the score. */
function RiskGauge({ score, category }) {
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * circumference;
  const color = CATEGORY_COLOR[category] || 'var(--text-dim)';

  return (
    <div className="gauge">
      <svg width="112" height="112" viewBox="0 0 112 112">
        <circle
          cx="56" cy="56" r={radius}
          fill="none" stroke="var(--border)" strokeWidth="8"
        />
        <circle
          cx="56" cy="56" r={radius}
          fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
        />
      </svg>
      <div className="gauge-label">
        <span className="gauge-score" style={{ color }}>{score}</span>
        <span className="gauge-of">/ 100</span>
      </div>
    </div>
  );
}

/**
 * ResultsPanel — renders the full merged analysis: the overall risk gauge
 * and badge, the deterministic findings checklist, and the LLM's assessment.
 */
export default function ResultsPanel({ result }) {
  if (!result) return null;

  const color = CATEGORY_COLOR[result.overallRiskCategory] || 'var(--text-dim)';

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <span className="dot" style={{ background: color }} />
          <h2>Threat Assessment</h2>
        </div>
        <div className="risk-banner">
          <RiskGauge
            score={result.overallRiskScore}
            category={result.overallRiskCategory}
          />
          <div className="risk-verdict">
            <div className="risk-cat" style={{ color }}>
              {result.overallRiskCategory} risk
            </div>
            <div className="risk-sub">
              {result.emailSubject
                ? `Subject: ${result.emailSubject}`
                : 'No subject line detected'}
              {result.senderDomain ? ` · from ${result.senderDomain}` : ''}
            </div>
            <span className={`badge ${result.aiAvailable ? 'ok' : 'degraded'}`}>
              {result.aiAvailable
                ? 'Rules + AI'
                : 'Rules only · AI degraded'}
            </span>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="dot" />
          <h2>Rule Engine — Deterministic Checks</h2>
        </div>
        <div className="panel-body">
          <RuleFindingsList findings={result.ruleFindings} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="dot" style={{ background: 'var(--cool)' }} />
          <h2>AI Assessment — Holistic Analysis</h2>
        </div>
        <div className="panel-body">
          <AIAssessment
            assessment={result.aiAssessment}
            available={result.aiAvailable}
            error={result.aiError}
          />
        </div>
      </div>
    </>
  );
}
