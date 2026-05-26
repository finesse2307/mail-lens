import { useState } from 'react';
import EmailInput from './components/EmailInput';
import ResultsPanel from './components/ResultsPanel';
import HistoryView from './components/HistoryView';
import { analyzeEmail } from './apiClient';
import './styles/app.css';

/**
 * App — the single-page application shell.
 * Two views: "analyze" (input + results) and "history".
 */
export default function App() {
  const [view, setView] = useState('analyze');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleAnalyze(rawEmail) {
    setBusy(true);
    setError(null);
    try {
      const analysis = await analyzeEmail(rawEmail);
      setResult(analysis);
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <div className="brand-mark">
            Mail<span className="lens">Lens</span>
          </div>
          <span className="brand-tag">email threat analysis</span>
        </div>
        <nav className="nav">
          <button
            className={view === 'analyze' ? 'active' : ''}
            onClick={() => setView('analyze')}
          >
            Analyze
          </button>
          <button
            className={view === 'history' ? 'active' : ''}
            onClick={() => setView('history')}
          >
            History
          </button>
        </nav>
      </header>

      {view === 'analyze' && (
        <>
          <EmailInput onAnalyze={handleAnalyze} busy={busy} />
          {error && <div className="error-bar">{error}</div>}
          {busy && (
            <div className="panel">
              <div className="panel-body">
                <p className="loading">
                  Running rule engine and requesting AI assessment…
                </p>
              </div>
            </div>
          )}
          {!busy && result && <ResultsPanel result={result} />}
        </>
      )}

      {view === 'history' && <HistoryView />}
    </div>
  );
}
