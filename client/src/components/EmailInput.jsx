import { useState } from 'react';

/** A built-in phishing sample so reviewers can try the app in one click. */
const SAMPLE_EMAIL = `From: "PayPal Service" <security@paypa1-secure.com>
To: you@example.com
Subject: Your account has been suspended - verify immediately
Authentication-Results: mx.example.com; spf=fail; dkim=none; dmarc=fail
Content-Type: text/html

Dear customer, we detected unusual activity on your account.
Your account has been suspended. You must verify immediately within
24 hours or your account will be closed.

<a href="http://203.0.113.45/paypal/login">https://www.paypal.com/login</a>`;

/**
 * EmailInput — textarea for the raw email, basic client-side validation,
 * and an Analyze button. Validation here mirrors the server's: non-empty
 * and "email-ish" (has headers or an address).
 */
export default function EmailInput({ onAnalyze, busy }) {
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);

  const trimmed = text.trim();
  const looksEmailish =
    /^[A-Za-z-]+:\s/m.test(text) || /[^\s@]+@[^\s@]+\.[^\s@]+/.test(text);
  const validationMessage =
    trimmed.length === 0
      ? 'Paste an email to analyze.'
      : !looksEmailish
        ? 'This does not look like an email (no headers or addresses found).'
        : null;

  function handleSubmit() {
    setTouched(true);
    if (validationMessage) return;
    onAnalyze(text);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="dot" />
        <h2>Raw Email Input</h2>
      </div>
      <div className="panel-body">
        <textarea
          className="email-input"
          placeholder="Paste the full raw email here — headers and body…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
        <div className="input-row">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => { setText(SAMPLE_EMAIL); setTouched(false); }}
          >
            Load sample
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="hint">
              {text.length.toLocaleString()} chars
            </span>
            <button
              type="button"
              className="btn-analyze"
              onClick={handleSubmit}
              disabled={busy}
            >
              {busy ? 'Analyzing…' : 'Analyze'}
            </button>
          </div>
        </div>
        {touched && validationMessage && (
          <div className="error-bar">{validationMessage}</div>
        )}
      </div>
    </div>
  );
}
