import { useEffect, useState } from 'react';
import { fetchAnalyses, fetchAnalysisById } from '../apiClient';
import ResultsPanel from './ResultsPanel';

const CATEGORY_COLOR = {
  high: 'var(--risk-high)',
  medium: 'var(--risk-medium)',
  low: 'var(--risk-low)',
  minimal: 'var(--risk-minimal)',
};

/** Format an ISO timestamp compactly for the history list. */
function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * HistoryView — lists past analyses pulled from the backend. Clicking a row
 * fetches that full analysis and renders it with the same ResultsPanel.
 */
export default function HistoryView() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    let active = true;
    fetchAnalyses()
      .then((data) => { if (active) setRows(data); })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);

  async function openRow(id) {
    setLoadingDetail(true);
    setError(null);
    try {
      const full = await fetchAnalysisById(id);
      setSelected(full);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingDetail(false);
    }
  }

  // Detail view for one selected analysis.
  if (selected) {
    return (
      <div>
        <ResultsPanel result={selected} />
        <button className="detail-back" onClick={() => setSelected(null)}>
          ← Back to history
        </button>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="dot" />
        <h2>Analysis History</h2>
      </div>
      <div className="panel-body">
        {error && <div className="error-bar">{error}</div>}
        {loadingDetail && <p className="loading">Loading analysis…</p>}

        {rows === null && !error && <p className="loading">Loading history…</p>}

        {rows && rows.length === 0 && (
          <div className="empty">No analyses yet. Run one from the Analyze tab.</div>
        )}

        {rows && rows.length > 0 && (
          <div className="history-list">
            {rows.map((row) => {
              const color = CATEGORY_COLOR[row.overallRiskCategory] || 'var(--text-dim)';
              return (
                <button
                  className="history-row"
                  key={row._id}
                  onClick={() => openRow(row._id)}
                >
                  <div className="history-score" style={{ color }}>
                    {row.overallRiskScore}
                  </div>
                  <div>
                    <div className="history-subject">
                      {row.emailSubject || '(no subject)'}
                    </div>
                    <div className="history-meta">
                      {row.senderDomain || 'unknown sender'} · {formatTime(row.createdAt)}
                      {row.aiAvailable ? '' : ' · rules only'}
                    </div>
                  </div>
                  <div className="history-cat" style={{ color }}>
                    {row.overallRiskCategory}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
