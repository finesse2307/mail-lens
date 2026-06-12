# MailLens — Email Threat Analysis

A full-stack web app that analyzes raw emails for phishing indicators. It pairs
a **deterministic rule engine** with an **AI assessment from a large language model**, then
merges both into a single risk score.

The two layers are **independent by design**: if the LLM API call fails, the
rule engine still returns a complete result. This graceful degradation is the
core architectural decision of the project.

<img width="1470" height="832" alt="image" src="https://github.com/user-attachments/assets/60d09a9c-aff5-4c1b-bba7-4dc576f02faa" />


---

## Architecture

Three layers:

- **Frontend** — React single-page app (Vite). Paste an email, hit Analyze,
  see a results panel. A second view shows the history of past analyses.
- **Backend** — Node + Express. Runs the rule engine, calls the Gemini API with the
  email plus the rule findings, merges both into one result, saves it to
  MongoDB, and returns it.
- **Data + external** — MongoDB stores analyses; the Gemini API is the one
  external call. Deploys to Azure App Service.

```
 React SPA  ──POST /api/analyze──▶  Express
                                      │
                          ┌───────────┴───────────┐
                          ▼                       ▼
                    Rule engine             Gemini API
                   (deterministic)        (holistic, may fail)
                          │                       │
                          └───────────┬───────────┘
                                      ▼
                                 merge scores
                                      │
                                      ▼
                                  MongoDB  ──▶  result to client
```

If the LLM call errors or times out, the merge step simply uses the
rule-engine baseline and flags `aiAvailable: false`. The client renders
whatever it receives — full result, or rules-only.

---

## The rule engine

Six independent, pure-function checks. Each returns a finding of the shape
`{ id, label, passed, severity, detail }`:

1. **Header authentication** — parses SPF / DKIM / DMARC verdicts from the
   email headers and flags failures.
2. **Display-name spoofing** — detects when the "From" display name claims a
   brand the sender domain does not belong to.
3. **Lookalike domains** — checks sender and link domains for character
   substitution against common brands (`paypa1`, `arnazon`, `g00gle`) using
   Levenshtein distance.
4. **URL analysis** — extracts links, flags visible-text/href mismatches and
   raw IP-address URLs.
5. **Urgency / pressure language** — scans subject and body for a curated set
   of pressure phrases.
6. **Attachment red flags** — flags risky extensions and disguised double
   extensions (`invoice.pdf.exe`).

The engine derives a baseline score purely from rule severity, so it always
returns a result regardless of the AI layer.

---

## Score merge

The rule engine produces a baseline (0–100) from how many high-severity checks
failed. When the LLM is available, the overall score is a weighted blend —
**60% rules / 40% LLM** — with one rule: if any high-severity rule failed,
the baseline acts as a floor the model cannot undercut. Deterministic evidence
of a real problem should not be talked down by the model.

---

## API

| Route | Purpose |
|-------|---------|
| `POST /api/analyze` | Body is `{ email }`. Runs the rule engine, calls the LLM, merges, saves, returns the full result. |
| `GET /api/analyses` | Recent analyses for the history view. |
| `GET /api/analyses/:id` | One full analysis by id. |

The Gemini API key lives in a server-side environment variable and never
reaches the React bundle.

### LLM provider

The AI assessment uses Google's **Gemini API** (`gemini-2.5-flash`) on its
free tier — no credit card required. The free tier is rate limited (a small
number of requests per minute and per day); when the limit is hit, the API
returns a 429 and the app falls back to a rules-only result via the same
graceful-degradation path used for any other failure.

The LLM call is isolated in `services/llmService.js`. The prompt, JSON
parsing, and response normalization are provider-agnostic — only the HTTP
request shape is Gemini-specific — so swapping providers means changing one
file.

---

## Data model

One MongoDB collection, `analyses`. Each document holds the timestamp,
extracted sender fields, the rule findings array, the parsed LLM assessment
(or `null`), the merged `overallRiskScore`, and the `aiAvailable` flag.

If `MONGODB_URI` is unset, the app falls back to a non-persistent in-memory
store so it runs with zero external dependencies for local development.

---

## Running locally

```bash
# install both workspaces
npm run install:all

# configure the server
cp server/.env.example server/.env
# edit server/.env — add GEMINI_API_KEY (optional) and MONGODB_URI (optional)

# run the backend (terminal 1)
npm run dev:server      # http://localhost:4000

# run the frontend (terminal 2)
npm run dev:client      # http://localhost:5173  (proxies /api to :4000)
```

The app runs fully without an API key or a database — the AI layer degrades
gracefully and storage falls back to memory.

### Tests

```bash
npm test
```

50 tests total: 40 unit tests covering the email parser, all six checks, the
rule-engine orchestrator, the score-merge logic, and the LLM JSON
parsing/normalization — plus 10 route-level integration tests that boot the
real Express app and exercise all three API endpoints over HTTP, including the
graceful-degradation path and the 400/404 error cases.

CI runs the full suite and a client build on every push via GitHub Actions
(`.github/workflows/ci.yml`).

---

## Deploying to Azure

The Express server serves the built React app from `client/dist`, so the whole
app runs as a single Azure App Service.

CI/CD is handled by GitHub Actions:

- `.github/workflows/ci.yml` — installs, runs the 50-test suite, and builds the
  client on every push and pull request.
- `.github/workflows/deploy.yml` — on push to `main`, runs the tests, builds
  the client, and deploys to Azure App Service. Requires an
  `AZURE_WEBAPP_PUBLISH_PROFILE` repo secret.

Manual deploy:

1. Build the client: `npm run build`.
2. Deploy the repo to Azure App Service (Node 20+).
3. Set application settings: `GEMINI_API_KEY`, `MONGODB_URI`.
4. Set the startup command to `startup.sh`.

Deploy a minimal version early and redeploy as you go — far less painful than
one big deploy at the end.

---

## Project layout

```
phishing-analyzer/
├── .github/workflows/   ci.yml, deploy.yml
├── startup.sh           Azure startup command
├── server/
│   ├── src/
│   │   ├── ruleEngine/      parser.js, checks.js, index.js
│   │   ├── services/        llmService, analysisService, db
│   │   ├── routes/          api.js
│   │   ├── app.js           Express app factory (no side effects)
│   │   └── server.js        entry point: connect DB + listen
│   └── test/                50 tests (unit + route integration)
└── client/
    └── src/
        ├── components/      EmailInput, ResultsPanel, RuleFindingsList,
        │                    AIAssessment, HistoryView
        ├── apiClient.js
        └── App.jsx
```

---

## Notes for discussion

- **Graceful degradation** — the rule engine and the LLM call are
  independent; the app returns a real result even when the AI layer fails.
- **Deterministic core** — six pure, individually unit-tested functions; the
  score floor prevents the model from overriding hard evidence.
- **Separation of concerns** — parser, checks, orchestrator, AI service, data
  layer, and routes are each isolated and independently testable.
- **No secrets in the bundle** — the API key is server-side only.
