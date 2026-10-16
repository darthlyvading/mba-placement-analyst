# MBA Placement Strategy Analyst

A production-minded, zero-cost-deployable web application that helps MBA students evaluate campus placement job descriptions, detect IT services and bodyshop delivery traps disguised as consulting, calculate profile fit scores, and synthesize an evidence-grounded career strategy with a 24-week preparation roadmap.

Includes a **Historical Placement JD Database** (269 archival records from previous Great Lakes Institute of Management placement cycles) for longitudinal benchmarking and employer recurrence analysis.

---

## Architecture Overview

```
┌─────────────────────────────────┐        HTTPS        ┌───────────────────────────────────┐
│     Static Web Frontend         │ ──────────────────> │        Cloudflare Worker          │
│   (Hosted on GitHub Pages)      │                     │   GET  /api/health                │
│                                 │                     │   POST /api/analyze-batch         │
│ • HTML5, CSS3, Vanilla JS       │                     │   POST /api/synthesize            │
│ • Client-side Parsers:          │                     └─────────────────┬─────────────────┘
│   - PDF.js (PDF)                │                                       │
│   - Mammoth (DOCX)              │                                       │ HTTPS (x-goog-api-key)
│   - SheetJS (XLSX, CSV, TSV)    │                                       ▼
│ • In-Memory Processing          │                     ┌───────────────────────────────────┐
│ • Local Historical Precedent    │                     │      Google Gemini REST API       │
│   Matcher (Client-side)         │                     │    (gemini-2.0-flash / default)   │
│ • ZERO API Secrets in Browser   │                     └───────────────────────────────────┘
│ • Safe Relative Source Ref      │
└────────────────┬────────────────┘
                 │
                 │ Relative HTTP Fetch
                 ▼
┌─────────────────────────────────┐
│  data/previous_year_jds.json    │
│  (269 Archival GLIM Records)    │
└─────────────────────────────────┘
```

- **Frontend:** Pure HTML5, CSS, and Vanilla JavaScript hosted on **GitHub Pages**. Assets use relative paths (`./`) compatible with repository subpaths.
- **Backend:** A single serverless **Cloudflare Worker** acting as a secure AI proxy, handling batching, schema validation, CORS, rate-limit shielding, and error sanitization.
- **AI Engine:** Google Gemini REST API (`generateContent`) using server-side key authentication (`x-goog-api-key`).
- **Historical Evidence:** `data/previous_year_jds.json` loaded via relative path `./data/previous_year_jds.json`.
- **Data Persistence:** None. Current cycle documents and extracted text are processed in-memory and are never stored in a third-party database.

---

## Pre-Deployment Data Integrity, Privacy & Analytical Accuracy Audit

Before deploying the application to public hosting (GitHub Pages and Cloudflare Workers), a comprehensive pre-deployment audit was conducted:

### 1. Data Schema & Integrity
- **Dataset File:** `data/previous_year_jds.json`
- **Total Records:** Exactly 269 archival job description records across 135 unique employers.
- **Duplicate Records:** 0 (100% unique `jd_id` values from 1 to 269).
- **Source Preservation:** The original source JSON file was validated and preserved without destructive alteration.

### 2. Path Sanitization & Traceability
- **Finding:** The source JSON contains `file_path` values with local machine absolute paths.
- **Remediation:** The frontend implements `sanitizeSourceReference()`, which strips local drive letters, username directories, and absolute prefixes in runtime memory.
- **Traceability:** Safe relative references (`Company/Filename`) and immutable IDs (`HIST-XX`) are used throughout the UI, modals, and export formats (JSON, CSV, Markdown). Absolute filesystem paths are never displayed to users or leaked in downloadable reports.

### 3. Privacy & Sensitive Profile Information (Owner Review Required)
- **Sensitive Metadata Detected:** `metadata.candidate_profile` in `data/previous_year_jds.json` contains candidate details (age, 4.5y experience at Accenture India, GLIM PGPM program, core constraint).
- **Owner Review Flag:** Before pushing `data/previous_year_jds.json` to a public GitHub Pages repository, the project owner should review whether to retain, redact, or generalize `metadata.candidate_profile`.
- **Credential Check:** Audited all 269 records — zero emails, zero phone numbers, zero passwords, and zero API credentials exist in the dataset.
- **Client Form Defaults:** Input fields in `index.html` and fallback values in `script.js` use generic placeholders (`MBA Candidate`, `4+ years in Technology & Solutions`, standard scores) to avoid leaking personal candidate attributes on public browsers.

### 4. Data Provenance: Heuristic Estimates vs. Official Statistics
- **Provenance:** The attributes `fit_scores` (composite, profile, moat, escape), `ctc_estimates`, `prestige_tier`, and `strategic_rationale` in the historical dataset were pre-computed by an automated model for a baseline profile.
- **Labeling Standard:** All historical scores and CTC ranges are explicitly labeled in the UI as **"Pre-Computed Model Estimates (Heuristic Baseline)"** and **"Estimated Benchmarks"**.
- **Disclaimer:** The interface and downloadable reports state clearly that these are model benchmarks and do not represent independently audited college placement office records, verified offer letters, or company salary disclosures.

### 5. Placement Year Distinction
- **Explicit Years:** 0 records in `previous_year_jds.json` contain an explicit database placement-year field.
- **Inferred Years (38 records):** 2026 (27 roles), 2025 (8 roles), 2025-26 (2 roles), 2024 (1 role) — inferred from title or filename strings.
- **Unspecified Years (231 records):** 231 records have no verifiable year markers.
- **Handling:** Unverified years are strictly labeled as `Unspecified in source` or `Inferred from filename`. They are never converted into confirmed placement cycles.

### 6. Historical Metrics & Category Distribution
- **Employer Recurrence:** Labeled as `Employer Record Frequency (in 269-record archive)`. Disclaimers clarify that this reflects the number of archived JD documents available in this dataset, not total hiring volume, offer counts, or proof of recruitment across multiple seasons.
- **Category Distribution:** Uses the exact denominator of 269 records:
  - Category A (True Consulting): 96 (35.7%)
  - Category B (Product Management): 33 (12.3%)
  - Category C (Analytics): 27 (10.0%)
  - Category D (Marketing): 16 (5.9%)
  - Category E (Finance): 16 (5.9%)
  - Category F (Operations): 23 (8.6%)
  - Category G (IT Services Trap): 58 (21.6%)

### 7. Category G Isolation & Current-Cycle Count Invariant
- Historical records are loaded into a dedicated library (`AppState.historicalJds`) and are **never** added to current-cycle opportunity counts (`AppState.results.length`).
- Category G roles (routine coding, maintenance, bodyshop culture, ERP delivery) are strictly isolated and barred by prompt instructions and code invariants from appearing in positive recommendations (Primary, Backup, or Insurance tracks).

### 8. Backend Validation & Secret Protection
- The Cloudflare Worker (`worker/index.js`) strictly validates all payloads (capped at 512 KB, max 10 JDs per batch).
- The Gemini API key is read exclusively from the server-side environment secret (`env.GEMINI_API_KEY`) and is never returned in health checks or error payloads.
- Upstream error messages are sanitized using regex to strip API keys and tokens.

---

## Deployment Guide

### Step 1: Deploy the Cloudflare Worker Backend

1. **Install Wrangler CLI:**
   ```bash
   npm install -g wrangler
   ```

2. **Authenticate with Cloudflare:**
   ```bash
   wrangler login
   ```

3. **Deploy the Worker:**
   ```bash
   cd worker
   wrangler deploy
   ```
   *Note your public Worker URL:*
   `https://mba-placement-analyst.<YOUR_SUBDOMAIN>.workers.dev`

4. **Set the Gemini API Key Secret:**
   Obtain a free Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey), then run:
   ```bash
   wrangler secret put GEMINI_API_KEY
   ```
   *Paste your API key when prompted.*

5. **Verify Worker Health:**
   ```bash
   curl "https://mba-placement-analyst.<YOUR_SUBDOMAIN>.workers.dev/api/health"
   ```

---

### Step 2: Configure the Public Frontend

1. Open `script.js` in your editor.
2. Locate the public configuration setting at the top:
   ```javascript
   const DEFAULT_WORKER_URL = 'https://mba-placement-analyst.<YOUR_SUBDOMAIN>.workers.dev';
   ```
3. Set `DEFAULT_WORKER_URL` to your live Cloudflare Worker URL.
   *(Leave as `''` if you want visitors to explore the historical database in offline mode without AI analysis enabled).*

---

### Step 3: Deploy Frontend to GitHub Pages

1. **Initialize Git Repository (if not already done):**
   ```bash
   git init
   git add .
   git commit -m "feat: configure public deployment for MBA Placement Strategy Analyst"
   ```

2. **Push Code to GitHub:**
   ```bash
   git remote add origin https://github.com/<YOUR_USERNAME>/mba-placement-analyst.git
   git branch -M main
   git push -u origin main
   ```

3. **Enable GitHub Pages:**
   - In your GitHub repository: **Settings → Pages**.
   - Source: **Deploy from a branch** → Branch: **main** → Folder: **/(root)**.
   - Click **Save**.
   - Your site will be live at: `https://<YOUR_USERNAME>.github.io/mba-placement-analyst/`.

4. **Zero-Configuration Visitor Experience:**
   - Visitors visiting your GitHub Pages URL do **not** need to enter, save, or know any Worker URL.
   - Health checks, batch JD classifications, and synthesis roadmaps automatically connect through `DEFAULT_WORKER_URL`.
   - If `DEFAULT_WORKER_URL` is empty or unconfigured, the top banner politely discloses that live AI analysis is disabled, while the 269-record Historical JD Library, search filters, and synthetic fixtures remain 100% accessible.

---

## Local Testing (Offline / Pre-Deployment)

Run the frontend locally using Python's built-in HTTP server:
```bash
python -m http.server 8080
```
Open `http://localhost:8080` in your web browser. The historical database loads from `./data/previous_year_jds.json`.

---

## Quotas and Free-Tier Disclosures

| Component | Free Tier Quota | Notes |
|---|---|---|
| **Google Gemini 2.0 Flash** | 15 Requests per Minute (RPM)<br/>1,500 Requests per Day (RPD)<br/>1,000,000 Tokens per Minute | Free tier via Google AI Studio. Batching ensures minimal token consumption. |
| **Cloudflare Workers** | 100,000 requests per day<br/>1,000 requests per minute | Free serverless tier. Zero ongoing hosting cost. |
| **GitHub Pages** | 1 GB storage limit<br/>100 GB bandwidth / month | Free static hosting for personal and organizational repositories. |
| **Client Ingestion** | Up to 100 JDs in memory | Document parsing occurs entirely in the user's browser. |
