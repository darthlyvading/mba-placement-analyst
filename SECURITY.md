# Security Policy — MBA Placement Strategy Analyst

## Pre-Deployment Privacy & Data Protection Audit

Before deploying this application to public repositories (GitHub) or public hosting (GitHub Pages), the following privacy and data classifications must be observed:

### 1. Data Integrity and Source Preservation
- The source dataset `data/previous_year_jds.json` was audited across all 269 records.
- **Credential & Contact Verification:** 0 email addresses, 0 phone numbers, 0 passwords, and 0 API keys were found in the dataset.
- **Source Data Policy:** The underlying dataset is preserved intact without destructive alteration.

### 2. Candidate Profile Information (Redacted for Production)
- **Redaction Applied:** The biographical `metadata.candidate_profile` object has been removed from `data/previous_year_jds.json` for public publication, leaving only macro statistics (`total_jds_analyzed` and `classification_distribution`). The original historical file containing the baseline profile is securely backed up outside the repository (`previous_year_jds.original_backup.json`).
- **Frontend Isolation:** The frontend (`script.js`) strictly isolates `AppState.historicalMetadata` and never exposes biographical attributes in public tabs, rendered views, or downloadable reports unless the user explicitly enters their own profile.
- **Generic Form Defaults:** All browser input forms default to generic candidate placeholders (`MBA Candidate`, `Great Lakes Institute of Management`, `4+ years in Technology & Solutions`, standard academic scores) to prevent inadvertent disclosure of personal data.

### 3. Absolute Filesystem Path Scrubbing
- **Sanitized Dataset:** In the published `data/previous_year_jds.json`, all absolute Windows filesystem paths have been scrubbed and replaced with safe relative references (`Company/Filename.pdf`). The original un-sanitized source file is backed up externally outside the repository.
- **Runtime Mitigation:** The frontend also includes an active sanitization adapter (`sanitizeSourceReference()`). This adapter strips any drive letters, username directories, and absolute prefixes in browser memory.
- **Exposed References:** UI displays, modal details, JSON exports, CSV exports, and Markdown summaries only use safe relative references (e.g. `Company/Filename.pdf`) and stable identifiers (`HIST-XX`). Absolute paths are never exposed to public visitors.

### 4. Data Provenance & Heuristic Labeling
- Scores (`profile_fit`, `composite_fit`, `escape_velocity`, `competitive_moat`) and `ctc_estimates` in the historical dataset are model-derived heuristic benchmarks from an earlier evaluation cycle.
- They are not official college placement statistics, audited salary figures, or guaranteed corporate offer letters.
- The UI and export reports explicitly label them as heuristic estimates and require user acknowledgement.

---

## Core Security Principles

1. **Zero Secrets in Frontend:**
   - No API keys, tokens, or credentials exist in `index.html`, `style.css`, `script.js`, `data/previous_year_jds.json`, or repository assets.
   - The frontend is a static web client that communicates exclusively with the configured Cloudflare Worker.

2. **Server-Side Secret Management:**
   - The Google Gemini API key is stored exclusively as an encrypted secret in Cloudflare's serverless environment (`GEMINI_API_KEY`).
   - The secret is accessed inside the Worker runtime via `env.GEMINI_API_KEY` and transmitted to Google's REST API using the secure HTTP request header `x-goog-api-key`.
   - The secret is never returned in HTTP response headers, response bodies, or debug logs.

3. **Public Historical Dataset Disclosure:**
   - The file `data/previous_year_jds.json` is a public static dataset served alongside frontend assets on GitHub Pages.
   - It contains campus recruitment job descriptions and anonymized role profiles.
   - Do **not** commit student private identifiers, unredacted personal phone numbers, or proprietary non-public documents to this dataset.

4. **Error Redaction and Sanitization:**
   - Upstream error messages are scrubbed using regular expression filters to remove any sensitive substrings (e.g. `AIza...` key patterns or URL query parameters).
   - Internal stack traces are never exposed to the browser client; sanitized error messages and machine-readable error codes (e.g. `UPSTREAM_AI_ERROR`, `PAYLOAD_TOO_LARGE`) are returned instead.

5. **Abuse Mitigation & Quota Guardrails:**
   - **Payload Limit:** Incoming JSON payloads are capped at 512 KB per request to prevent buffer abuse.
   - **Batch Limit:** The `/api/analyze-batch` endpoint strictly rejects batches exceeding 10 JDs per call to protect API quotas.
   - **Kill Switch:** An administrative kill switch (`KILL_SWITCH = "true"`) is built into the Worker to instantly disable AI analysis operations without interrupting static site hosting.
   - **Strict CORS Origin Allowlist:** The backend is configured to accept requests exclusively from `https://darthlyvading.github.io`. Any other cross-origin browser request receives HTTP 403 Forbidden and zero wildcard access headers.
   - **CORS Is Not Authentication:** CORS is enforced by browsers, not non-browser clients (curl/scripts). The Worker does not rely on CORS for API authorization; sensitive operations are protected by rate limits, secret isolation, and payload constraints.
   - **Isolate-Local Rate Limiting:** A sliding window limiter caps AI analysis calls to a maximum of 20 requests per 5 minutes per client IP (`CF-Connecting-IP`). This provides best-effort burst abuse protection within free-tier Cloudflare Worker isolates without incurring external database latency. (Note: rate limits are isolate-local and not globally synchronized across all Cloudflare edge datacenters).
   - **Supported Gemini Models:** Default model is `gemini-3.8-flash`. Fallbacks `gemini-2.5-flash`, `gemini-1.5-flash`, and `gemini-1.5-pro` are accepted by the server-side model allowlist.

6. **Data Privacy and Retention:**
   - The application does not maintain a database or persistent server-side file storage.
   - Job descriptions are parsed client-side in browser memory and transmitted to the AI provider only upon explicit user invocation of the analysis pipeline.
   - No current JD contents or analysis outputs are saved to browser `localStorage` or `sessionStorage` by default.

---

## Pinned External Dependencies (Browser-Side)

All third-party libraries loaded via CDN are pinned to immutable releases:

| Library | Pinned Version | Integrity & Source | Purpose |
|---|---|---|---|
| **PDF.js** | `3.11.174` | `https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js` | Client-side text layer extraction from PDF files |
| **Mammoth.js** | `1.6.0` | `https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js` | Client-side document text extraction from DOCX files |
| **SheetJS (xlsx)** | `0.18.5` | `https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js` | Parsing CSV, TSV, and XLSX spreadsheets with column mapping |

---

## Reporting a Security Vulnerability

If you discover a security vulnerability or credential leak, please report it privately:
- Do **not** post details in public GitHub issues.
- If an API key was accidentally committed, revoke it immediately at [Google AI Studio](https://aistudio.google.com/app/apikey) and re-provision via `wrangler secret put GEMINI_API_KEY`.
