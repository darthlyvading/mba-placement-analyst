/**
 * MBA Placement Strategy Analyst — Frontend Application Logic
 * File: script.js
 *
 * Integrated Features:
 * - Client-side file ingestion: PDF, DOCX, TXT, MD, CSV, TSV, JSON, XLSX
 * - Spreadsheet column mapping dialog (CSV, TSV, XLSX)
 * - Synthetic test data fixtures (clearly tagged with 🧪 TEST FIXTURE)
 * - Historical Placement JD Database (data/previous_year_jds.json) integration:
 *   - Normalization / adapter layer for GLIM historical placement records
 *   - Dedicated Historical JD Library with search, filtering, and detail modal
 *   - Historical Trends & Recurrence Analytics (100% computed from verified data)
 *   - Explainable local similarity search providing bounded historical context to AI
 *   - Bi-directional audit links from Current Verified JDs to Historical Precedents
 * - 5-Stage Orchestration Pipeline with cancellation and partial retry
 * - Searchable & filterable JD data table
 * - Category G trap exclusion from positive career recommendations
 * - Clean exports: JSON (no markdown fences), CSV, Markdown, Print / PDF
 * - Strict adherence to zero-secrets-in-frontend policy
'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PUBLIC BACKEND CONFIGURATION
 * Set DEFAULT_WORKER_URL to your deployed Cloudflare Worker URL.
 * Example: 'https://mba-placement-analyst.<your-subdomain>.workers.dev'
 * Leave as '' (empty string placeholder) until the Worker URL is known.
 * All health checks, batch analyses, and synthesis requests use this automatically.
 * Visitors do not need to enter or save a URL in their own browsers.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const DEFAULT_WORKER_URL = '';

// ── PDF.js Worker Configuration ─────────────────────────────────────────────
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
}

// ── Application State ───────────────────────────────────────────────────────
const AppState = {
  backendUrl: DEFAULT_WORKER_URL.trim().replace(/\/+$/, ''),
  jds: [],                  // Array of IngestedJD objects (Current cycle)
  results: [],              // Array of VerifiedJDResult objects (Current cycle)
  historicalJds: [],        // Array of NormalizedHistoricalJD objects (Historical archive)
  historicalMetadata: null, // Raw metadata from data/previous_year_jds.json
  historicalAvailable: false,
  summary: null,            // ExecutiveSummary object
  strategy: null,           // CrossCategoryStrategy object
  roadmap: null,            // RoadmapWeek[] array
  isAnalyzing: false,
  abortController: null,
  activePendingSpreadsheet: null, // Temporary store during mapping
  weights: { earnings: 30, prestige: 25, fit: 25, escape: 20 },
};
window.AppState = AppState;

// ── Category Definitions ────────────────────────────────────────────────────
const CATEGORIES = {
  A: { code: 'A', name: 'True Consulting',    pillCls: 'cat-pill-A', icon: '🔵' },
  B: { code: 'B', name: 'Product Management', pillCls: 'cat-pill-B', icon: '🟢' },
  C: { code: 'C', name: 'Analytics',          pillCls: 'cat-pill-C', icon: '🟣' },
  D: { code: 'D', name: 'Marketing',          pillCls: 'cat-pill-D', icon: '🟡' },
  E: { code: 'E', name: 'Finance',            pillCls: 'cat-pill-E', icon: '🩵' },
  F: { code: 'F', name: 'Operations',         pillCls: 'cat-pill-F', icon: '🟠' },
  G: { code: 'G', name: 'IT Services Trap',   pillCls: 'cat-pill-G', icon: '🔴' },
};

// ── Synthetic Test Fixtures (Clearly Labeled as Test Data) ──────────────────
const SYNTHETIC_TEST_FIXTURES = [
  {
    filename: '[TEST FIXTURE] McKinsey & Co - Associate Consultant.txt',
    employer: 'McKinsey & Company',
    title: 'Associate Consultant (Strategy Advisory)',
    location: 'Mumbai / Gurugram',
    compensation: '32-35 LPA Fixed + Performance Bonus',
    isTestFixture: true,
    text: `About the Role: McKinsey & Company is seeking exceptional MBA graduates to join as Associate Consultants.
Responsibilities:
- Advise CXO leadership of Fortune 500 enterprises on high-stakes strategic growth, digital reinvention, and business model transformation.
- Lead structured problem-solving workstreams, formulating hypotheses, conducting senior executive interviews, and synthesizing rigorous quantitative models.
- Present strategic recommendations directly to C-level client steering committees.
- Design comprehensive change management roadmaps and monitor commercial value realization.
Requirements:
- Top-tier MBA with a track record of structured problem-solving, intellectual curiosity, and leadership.
- Ability to break down ambiguous business challenges and communicate with senior corporate executives.
- High-level advisory orientation with substantial client exposure. This is a purely strategic advisory engagement.`,
  },
  {
    filename: '[TEST FIXTURE] HighRadius - B2B SaaS Enterprise Product Manager.txt',
    employer: 'HighRadius Corporation',
    title: 'Product Manager (Autonomous Finance Platform)',
    location: 'Hyderabad / Bengaluru',
    compensation: '26-28 LPA CTC',
    isTestFixture: true,
    text: `About HighRadius: HighRadius is a leading B2B SaaS FinTech company powering Autonomous Systems for Order-to-Cash and Treasury.
Responsibilities:
- Own the product lifecycle, roadmapping, and feature prioritization for our enterprise accounts receivable module.
- Synthesize user research, customer telemetry, and enterprise client feedback into detailed Product Requirement Documents (PRDs).
- Partner cross-functionally with Engineering, UX design, and Go-To-Market (GTM) teams to deliver scalable cloud software features.
- Define and track product success metrics including adoption velocity, NPS, and annual recurring revenue (ARR) retention.
- Act as the solution evangelist for enterprise clients during executive roadmap walkthroughs.
Requirements:
- MBA + Engineering background. Prior experience in software engineering, technical solutioning, or systems architecture is highly preferred.
- Familiarity with Agile methodologies, API integrations, and cloud data architectures.`,
  },
  {
    filename: '[TEST FIXTURE] ZS Associates - Decision Analytics Consultant.txt',
    employer: 'ZS Associates',
    title: 'Analytics Consultant (Commercial Strategy)',
    location: 'Pune / Gurugram',
    compensation: '22-25 LPA CTC',
    isTestFixture: true,
    text: `ZS is a management consulting and technology firm focused on transforming global healthcare, pharmaceutical, and technology enterprises.
Responsibilities:
- Collaborate with global client leadership to optimize commercial sales strategy, marketing mix modeling, and market access analytics.
- Design advanced analytical frameworks combining structured enterprise data, customer journey telemetry, and predictive ML models.
- Translate complex statistical insights into actionable commercial strategies for non-technical commercial business heads.
- Lead junior analysts in data structuring, pipeline governance, and executive slide deck creation.
Requirements:
- MBA with technical/quantitative undergraduate degree.
- Proficiency in SQL, analytical problem-solving, and data storytelling. Comfort navigating both technical datasets and client business conversations.`,
  },
  {
    filename: '[TEST FIXTURE] Global Tech Outsourcing - Senior Java Support & Maintenance Lead.txt',
    employer: 'Global Tech Outsourcing Solutions',
    title: 'Consultant - Java Backend Maintenance (Staff Augmentation)',
    location: 'Chennai / Noida',
    compensation: '12-14 LPA',
    isTestFixture: true,
    text: `Client Engagement: Large US Banking client legacy maintenance contract.
Responsibilities:
- Act as a Team Lead for offshore staff augmentation, supporting 24/7 ticket resolution and L2/L3 production bug fixes on legacy Java systems.
- Execute routine code refactoring, database patch updates, and minor enhancements based on client-provided Jira tickets.
- Coordinate shift handovers and adhere strictly to client service-level agreements (SLAs).
- Provide weekly ticket count status reports to onshore delivery managers.
- Pure back-office implementation and maintenance delivery. No direct client stakeholder advisory or business strategy scope.
Requirements:
- 4+ years of hands-on Java/J2EE programming experience. Willingness to work in shifts and maintain existing production systems.`,
  },
];

// ── DOM Helpers ─────────────────────────────────────────────────────────────
const $ = (selector, context = document) => context.querySelector(selector);
const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];
const escapeHtml = str => String(str ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function generateId(prefix = 'jd') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

function computeSimpleHash(text) {
  let hash = 0;
  const str = text.trim().slice(0, 800);
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return `h_${Math.abs(hash).toString(36)}`;
}

function getScoreBadge(score, label = '') {
  if (typeof score !== 'number' || isNaN(score)) return '<span style="color:var(--text-muted);">—</span>';
  let cls = 'score-low';
  if (score >= 7) cls = 'score-high';
  else if (score >= 4) cls = 'score-mid';
  return `<span class="score-badge ${cls}" title="${label}: ${score}/10">${score}</span>`;
}

function appendConsoleLog(message) {
  const logEl = $('#liveConsoleLog');
  if (!logEl) return;
  const ts = new Date().toLocaleTimeString();
  logEl.textContent += `[${ts}] ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

// ── Tab Management ──────────────────────────────────────────────────────────
function initTabs() {
  $$('.tab-btn').forEach(button => {
    button.addEventListener('click', () => {
      $$('.tab-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      $$('.tab-content').forEach(p => { p.style.display = 'none'; });

      button.classList.add('active');
      button.setAttribute('aria-selected', 'true');
      const targetId = button.dataset.tab;
      const panel = $(`#${targetId}`);
      if (panel) panel.style.display = 'block';
    });
  });
}

// ── Backend Configuration Management ────────────────────────────────────────
function initBackendConfig() {
  const statusMsg = $('#backendStatusMessage');
  const retryBtn = $('#btnTestBackend');
  const startBtn = $('#btnStartAnalysis');

  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      if (AppState.backendUrl) {
        testBackendConnection(AppState.backendUrl, true);
      }
    });
  }

  if (AppState.backendUrl) {
    testBackendConnection(AppState.backendUrl, false);
  } else {
    statusMsg.innerHTML = '<span style="color:#854d0e;">⚠️ <strong>Backend AI service not configured:</strong> The site owner must set <code>DEFAULT_WORKER_URL</code> in <code>script.js</code> to enable live Gemini AI analysis. <em>Historical JD Library (269 records) and client-side browsing remain fully functional.</em></span>';
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.title = 'AI analysis is disabled because DEFAULT_WORKER_URL is empty in script.js.';
    }
  }
}

async function testBackendConnection(url, verboseAlert = true) {
  const statusMsg = $('#backendStatusMessage');
  const retryBtn = $('#btnTestBackend');
  const startBtn = $('#btnStartAnalysis');

  try {
    statusMsg.textContent = 'Connecting to backend…';
    const response = await fetch(`${url}/api/health`, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    if (data.killSwitchActive) {
      statusMsg.innerHTML = '🛑 <strong>Kill switch active:</strong> AI calls are disabled by administrator.';
      if (startBtn) startBtn.disabled = true;
      if (retryBtn) retryBtn.style.display = 'inline-flex';
    } else if (!data.configured) {
      statusMsg.innerHTML = '⚠️ <strong>Backend connected, but unconfigured:</strong> GEMINI_API_KEY secret missing in Worker.';
      if (startBtn) startBtn.disabled = true;
      if (retryBtn) retryBtn.style.display = 'inline-flex';
    } else {
      statusMsg.innerHTML = `✓ <strong>Connected:</strong> Cloudflare Worker ready (${escapeHtml(data.model)}).`;
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.title = '';
      }
      if (retryBtn) retryBtn.style.display = 'none';
    }
  } catch (err) {
    statusMsg.innerHTML = `<span style="color:var(--danger);">✗ <strong>Backend unreachable:</strong> ${escapeHtml(err.message)}</span>`;
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.title = 'AI analysis is unavailable because the backend cannot be reached.';
    }
    if (retryBtn) retryBtn.style.display = 'inline-flex';
    if (verboseAlert) {
      alert(`Cannot connect to Worker at ${url}\nError: ${err.message}\nEnsure CORS and Worker deployment are active.`);
    }
  }
}

// ── Candidate Profile & Scoring Weights ─────────────────────────────────────
function getCandidateProfile() {
  return {
    name: $('#profName')?.value.trim() || 'MBA Candidate',
    mba: $('#profMba')?.value.trim() || 'Great Lakes Institute of Management, Chennai',
    prevExp: $('#profPrevExp')?.value.trim() || '4+ years in Technology & Solutions',
    expAreas: $('#profExpAreas')?.value.trim() || 'Solution architecture, client stakeholder management, project scoping, delivery execution, coding',
    class10: $('#profC10')?.value || '90',
    class12: $('#profC12')?.value || '90',
    btech: $('#profBtech')?.value || '75',
    strengths: $('#profStrengths')?.value.trim() || 'Translating technology to business, solutioning, delivery execution, client communication',
    inclination: $('#profInclination')?.value.trim() || 'Technology strategy and digital transformation consulting',
    constraint: $('#profConstraint')?.value.trim() || 'Wants to permanently leave IT services, staff augmentation, and bodyshop culture',
    unacceptable: $('#profUnacceptable')?.value.trim() || 'Staff augmentation, implementation-heavy ERP delivery, routine coding and maintenance, outsourcing delivery disguised as consulting',
    geo: 'India, flexible across cities',
  };
}

function initWeightsControls() {
  const sliders = [
    { id: 'weightEarnings', key: 'earnings', labelId: 'valWeightEarnings' },
    { id: 'weightPrestige', key: 'prestige', labelId: 'valWeightPrestige' },
    { id: 'weightFit',      key: 'fit',      labelId: 'valWeightFit' },
    { id: 'weightEscape',   key: 'escape',   labelId: 'valWeightEscape' },
  ];

  function validateWeights() {
    let sum = 0;
    sliders.forEach(s => {
      const val = parseInt($(`#${s.id}`).value, 10) || 0;
      AppState.weights[s.key] = val;
      $(`#${s.labelId}`).textContent = val;
      sum += val;
    });

    const notice = $('#weightValidationNotice');
    if (sum === 100) {
      notice.className = 'alert alert-success';
      notice.innerHTML = `✓ Total Weight: <strong>100%</strong> (Valid configuration)`;
    } else {
      notice.className = 'alert alert-danger';
      notice.innerHTML = `✗ Total Weight: <strong>${sum}%</strong> (Must equal exactly 100%)`;
    }
  }

  sliders.forEach(s => {
    $(`#${s.id}`).addEventListener('input', validateWeights);
  });
  validateWeights();
}

// ═════════════════════════════════════════════════════════════════════════════
// HISTORICAL PLACEMENT DATABASE INTEGRATION & NORMALIZATION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Safe Relative Source Reference Sanitizer
 * Strips local machine filesystem paths (e.g. <LOCAL_DISK_PATH>/PGPM - JD/Company/file.pdf)
 * to preserve source traceability using safe relative references and stable IDs without exposing private local directories.
 */
function sanitizeSourceReference(rawPath, company, roleTitle) {
  if (!rawPath) return company ? `${company} / Archival JD` : 'Archival JD Reference';
  let p = String(rawPath).replace(/\\/g, '/');

  const markerIdx = p.toLowerCase().lastIndexOf('pgpm - jd/');
  if (markerIdx !== -1) {
    p = p.substring(markerIdx + 'pgpm - jd/'.length);
  } else {
    p = p.replace(/^[A-Za-z]:[/\\](?:Users|home)[/\\][^/\\]+[/\\](?:Desktop[/\\])?/i, '');
    p = p.replace(/^[A-Za-z]:[/\\]+/i, '');
  }

  p = p.replace(/^\/+/, '');
  if (!p.includes('/') && company) {
    p = `${company}/${p}`;
  }

  return p || `${company || 'Archive'}/${roleTitle || 'file'}.pdf`;
}

/**
 * Normalization / Adapter Layer
 * Transforms raw records from data/previous_year_jds.json into the application's internal structure.
 * Note: Never exposes absolute local filesystem paths. Distinguishes inferred vs unspecified placement years.
 */
function normalizeHistoricalRecord(raw) {
  // Extract category code (e.g. "A. TRUE CONSULTING" -> "A")
  let catCode = 'A';
  let catName = 'True Consulting';
  if (raw.category) {
    const match = raw.category.match(/^([A-G])\.\s*(.+)$/);
    if (match) {
      catCode = match[1];
      catName = match[2];
    }
  }

  // Extract recorded year from title or file path, distinguish inferred from unspecified
  let recordedYear = 'Unspecified';
  let yearType = 'unspecified';
  const combinedText = `${raw.role_title || ''} ${raw.file_path || ''}`;
  const yearMatch = combinedText.match(/(202[0-9](?:-[0-9]{2,4})?)/);
  if (yearMatch) {
    recordedYear = yearMatch[1];
    yearType = 'inferred';
  }

  const safeRef = sanitizeSourceReference(raw.file_path, raw.company, raw.role_title);
  const isTrap = Boolean(raw.it_services_trap_flag || catCode === 'G');

  return {
    id: `hist-${raw.jd_id}`,
    rawId: raw.jd_id,
    sourceType: 'historical',
    isHistorical: true,
    employer: raw.company || 'Unknown Employer',
    roleTitle: raw.role_title || 'Unspecified Role Title',
    categoryCode: catCode,
    categoryName: catName,
    isTrap,
    year: recordedYear,
    yearType,
    yearDisplay: yearType === 'inferred' ? `${recordedYear} (Inferred)` : 'Unspecified',
    fitScores: raw.fit_scores || null,
    compositeFit: raw.fit_scores?.composite_fit ?? raw.fit_scores?.profile_fit ?? null,
    ctcEstimates: raw.ctc_estimates || null,
    y1Ctc: raw.ctc_estimates?.y1_median_range || 'Not specified',
    prestigeTier: raw.prestige_tier || 'Unspecified Tier',
    clientFacingIndex: raw.client_facing_index || 'Unspecified',
    strategicRationale: raw.strategic_rationale || '',
    safeSourceRef: safeRef,
    missingFields: [
      'raw_full_jd_body',
      yearType === 'unspecified' ? 'exact_placement_year' : 'verified_placement_cycle',
      'verified_hiring_outcomes',
      'independent_ctc_verification',
    ],
  };
}

async function loadHistoricalDatabase() {
  const alertEl = $('#histStatusAlert');
  const badgeEl = $('#badgeHistCount');

  try {
    const res = await fetch('./data/previous_year_jds.json');
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();
    if (!data || !Array.isArray(data.job_descriptions)) {
      throw new Error('Invalid historical JSON schema: missing "job_descriptions" array');
    }

    // Isolate metadata and map normalized records
    AppState.historicalMetadata = data.metadata || {};
    AppState.historicalJds = data.job_descriptions.map(normalizeHistoricalRecord);
    AppState.historicalAvailable = true;

    badgeEl.textContent = AppState.historicalJds.length;
    alertEl.className = 'alert alert-success';
    alertEl.innerHTML = `✓ <strong>Historical Placement Database:</strong> Loaded <strong>${AppState.historicalJds.length}</strong> archival records from Great Lakes previous cycles. <span style="font-size:0.8rem; display:block; margin-top:0.25rem; color:var(--text-muted);">Provenance Notice: Fit scores and CTC ranges are pre-computed model heuristics; placement years are inferred or unspecified.</span>`;

    renderHistoricalAnalytics();
    renderHistoricalTable();
    appendConsoleLog(`Loaded historical database: ${AppState.historicalJds.length} records parsed from data/previous_year_jds.json.`);
  } catch (err) {
    AppState.historicalAvailable = false;
    badgeEl.textContent = '0';
    alertEl.className = 'alert alert-warn';
    alertEl.innerHTML = `⚠ <strong>Historical Database Notice:</strong> Could not load <code>./data/previous_year_jds.json</code> (${escapeHtml(err.message)}). Current-cycle analysis will proceed independently without historical benchmarking.`;
    appendConsoleLog(`Historical database unavailable: ${err.message}`);
  }
}

/**
 * Historical Trends & Recurrence Analytics (100% computed from verified data)
 */
function renderHistoricalAnalytics() {
  const jds = AppState.historicalJds;
  if (!jds.length) return;

  // 1. Top Recurring Employers
  const empCounts = {};
  jds.forEach(j => {
    empCounts[j.employer] = (empCounts[j.employer] || 0) + 1;
  });
  const topEmps = Object.entries(empCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const maxEmpCount = topEmps[0] ? topEmps[0][1] : 1;
  const empListEl = $('#histEmployerRecurrenceList');
  empListEl.innerHTML = topEmps.map(([emp, count]) => `
    <div class="trend-bar-row">
      <div class="trend-bar-label" title="${escapeHtml(emp)}">${escapeHtml(emp)}</div>
      <div class="trend-bar-track">
        <div class="trend-bar-fill" style="width:${Math.round((count / maxEmpCount) * 100)}%; background:var(--navy-light);"></div>
      </div>
      <div class="trend-bar-val">${count} Archival JDs</div>
    </div>
  `).join('');

  // 2. Category Distribution
  const catCounts = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
  jds.forEach(j => {
    if (catCounts[j.categoryCode] !== undefined) catCounts[j.categoryCode]++;
  });

  const catBarsEl = $('#histCategoryDistributionBars');
  catBarsEl.innerHTML = Object.entries(catCounts).map(([cat, count]) => {
    const def = CATEGORIES[cat] || { name: cat };
    const pct = ((count / jds.length) * 100).toFixed(1);
    let color = 'var(--accent)';
    if (cat === 'A') color = 'var(--cat-a)';
    else if (cat === 'B') color = 'var(--cat-b)';
    else if (cat === 'C') color = 'var(--cat-c)';
    else if (cat === 'G') color = 'var(--cat-g)';

    return `
      <div class="trend-bar-row">
        <div class="trend-bar-label">${cat}. ${escapeHtml(def.name)}</div>
        <div class="trend-bar-track">
          <div class="trend-bar-fill" style="width:${pct}%; background:${color};"></div>
        </div>
        <div class="trend-bar-val">${count} (${pct}%)</div>
      </div>
    `;
  }).join('');
}

/**
 * Filterable Historical Table
 */
function initHistoricalTableFilters() {
  $('#histSearchInput').addEventListener('input', renderHistoricalTable);
  $('#histYearFilter').addEventListener('change', renderHistoricalTable);
  $('#histCategoryFilter').addEventListener('change', renderHistoricalTable);
  $('#histTrapFilter').addEventListener('change', renderHistoricalTable);
  $('#histSortSelect').addEventListener('change', renderHistoricalTable);
}

function renderHistoricalTable() {
  const tbody = $('#histTableBody');
  const countText = $('#histFilterCountText');

  if (!AppState.historicalJds.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:2rem; color:var(--text-muted);">Historical records not loaded.</td></tr>`;
    return;
  }

  const query = $('#histSearchInput').value.trim().toLowerCase();
  const yearFilter = $('#histYearFilter').value;
  const catFilter = $('#histCategoryFilter').value;
  const trapFilter = $('#histTrapFilter').value;
  const sortSelect = $('#histSortSelect').value;

  let filtered = AppState.historicalJds.filter(j => {
    if (yearFilter !== 'ALL' && j.year !== yearFilter) return false;
    if (catFilter !== 'ALL' && j.categoryCode !== catFilter) return false;
    if (trapFilter === 'SAFE_ONLY' && j.isTrap) return false;
    if (trapFilter === 'TRAPS_ONLY' && !j.isTrap) return false;

    if (query) {
      const hay = `${j.employer} ${j.roleTitle} ${j.strategicRationale} ${j.prestigeTier}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  // Sorting
  filtered.sort((a, b) => {
    if (sortSelect === 'FIT_DESC') return (b.compositeFit || 0) - (a.compositeFit || 0);
    if (sortSelect === 'COMPANY_ASC') return a.employer.localeCompare(b.employer);
    return a.rawId - b.rawId;
  });

  countText.textContent = filtered.length;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:2rem; color:var(--text-muted);">No historical records match the selected filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  // Show up to 100 items for performant DOM rendering
  filtered.slice(0, 100).forEach(j => {
    const tr = document.createElement('tr');
    if (j.isTrap) tr.className = 'row-trap';

    const catDef = CATEGORIES[j.categoryCode] || { name: j.categoryName, pillCls: 'cat-pill-A' };
    const trapBadge = j.isTrap
      ? '<span class="pill" style="background:#fee2e2; color:var(--danger); border:1px solid #f87171;">⛔ IT Trap</span>'
      : '<span class="pill" style="background:#dcfce7; color:var(--success);">✓ Safe</span>';

    tr.innerHTML = `
      <td><span class="pill-hist">HIST-${j.rawId}</span></td>
      <td><small style="font-weight:600;">${escapeHtml(j.yearDisplay || j.year)}</small></td>
      <td><strong>${escapeHtml(j.employer)}</strong></td>
      <td style="max-width:260px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(j.roleTitle)}">
        ${escapeHtml(j.roleTitle)}
      </td>
      <td><span class="pill ${catDef.pillCls}">${j.categoryCode}: ${catDef.name}</span></td>
      <td style="font-size:0.8rem; font-family:var(--mono);">${escapeHtml(j.y1Ctc)}</td>
      <td>${getScoreBadge(j.compositeFit, 'Composite Fit (Heuristic)')}</td>
      <td>${trapBadge}</td>
      <td>
        <button class="btn btn-secondary btn-sm btn-inspect-hist" data-rawid="${j.rawId}">Inspect</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  $$('.btn-inspect-hist').forEach(btn => {
    btn.addEventListener('click', e => {
      const rawId = parseInt(e.currentTarget.dataset.rawid, 10);
      const rec = AppState.historicalJds.find(j => j.rawId === rawId);
      if (rec) openHistoricalDetailModal(rec);
    });
  });
}

function openHistoricalDetailModal(j) {
  const modal = $('#historicalDetailModal');
  const catDef = CATEGORIES[j.categoryCode] || { name: j.categoryName, pillCls: 'cat-pill-A' };

  $('#histModalId').textContent = `HIST-${j.rawId}`;
  $('#histModalCategoryPill').className = `pill ${catDef.pillCls}`;
  $('#histModalCategoryPill').textContent = `${j.categoryCode}: ${catDef.name}`;
  $('#histModalTitle').textContent = `${j.employer} — ${j.roleTitle}`;

  const content = $('#histModalContent');
  content.innerHTML = `
    <div style="font-size:0.82rem; color:var(--text-muted); margin-bottom:0.75rem;">
      <strong>Source Trace:</strong> <code>${escapeHtml(j.safeSourceRef || `HIST-${j.rawId}`)}</code> | <strong>Archive ID:</strong> <code>HIST-${j.rawId}</code> | <strong>Placement Year:</strong> <span class="pill pill-sm" style="font-size:0.75rem;">${escapeHtml(j.yearDisplay)}</span>
    </div>

    ${j.isTrap ? '<div class="alert alert-danger" style="font-size:0.84rem;">⛔ <strong>Historical Category G Role:</strong> Classified as an IT Services Delivery / Staff Augmentation / Maintenance trap. Strictly excluded from positive career recommendations.</div>' : ''}

    <div class="panel-grid-3 section-gap">
      <div class="card">
        <small>Pre-Computed Heuristic Fit</small>
        <div style="font-size:1.4rem; font-weight:700;">${j.compositeFit ?? '—'} / 10</div>
        <small style="color:var(--text-muted);">Model Baseline (Profile: ${j.fitScores?.profile_fit ?? '—'} | Escape: ${j.fitScores?.escape_velocity ?? '—'})</small>
      </div>
      <div class="card">
        <small>Estimated Year 1 CTC (Benchmark)</small>
        <div style="font-size:1.15rem; font-weight:700; color:var(--navy);">${escapeHtml(j.y1Ctc)}</div>
        <small style="color:var(--text-muted);">Unverified estimate | Y5: ${escapeHtml(j.ctcEstimates?.y5_expected_range || '—')}</small>
      </div>
      <div class="card">
        <small>Prestige Tier (Heuristic)</small>
        <div style="font-size:0.92rem; font-weight:600; color:var(--navy-mid);">${escapeHtml(j.prestigeTier)}</div>
        <small style="color:var(--text-muted);">Client Index: ${escapeHtml(j.clientFacingIndex)}</small>
      </div>
    </div>

    <div class="section-gap">
      <h4>Strategic Placement Rationale (Historical Record):</h4>
      <div style="background:var(--bg-panel); border-left:3px solid var(--accent); padding:0.75rem; border-radius:var(--radius-sm); font-size:0.86rem; line-height:1.55;">
        ${escapeHtml(j.strategicRationale || 'No rationale available.')}
      </div>
    </div>

    <div class="section-gap">
      <h4>Scope, Provenance & Data Limitations:</h4>
      <p style="font-size:0.82rem; color:var(--text-muted); margin:0; line-height:1.55;">
        • <strong>Source Trace:</strong> <code>${escapeHtml(j.safeSourceRef)}</code> (Stable ID: <code>HIST-${j.rawId}</code>).<br/>
        • <strong>Data Provenance Notice:</strong> Fit scores, prestige tier, and CTC ranges are model-generated heuristic estimates from an earlier candidate evaluation. They are NOT official college placement cell statistics, audited salary figures, or guaranteed employer offers.<br/>
        • <strong>Placement Cycle:</strong> ${j.yearType === 'inferred' ? `Inferred from filename/title pattern ("${escapeHtml(j.year)}"), not an officially verified placement cycle.` : 'Unspecified in source data.'}<br/>
        • <strong>Missing Attributes:</strong> ${j.missingFields.join(', ')}.
      </p>
    </div>
  `;

  modal.classList.add('open');
}

function initHistoricalModalButtons() {
  $('#btnCloseHistModal').addEventListener('click', () => {
    $('#historicalDetailModal').classList.remove('open');
  });
}

// ── Explainable Local Similarity Matcher for Current JDs ────────────────────
/**
 * Searches the historical dataset locally for the top 1-2 most relevant records
 * to pass as bounded context into the Gemini classification prompt.
 */
function findHistoricalMatches(currentJd) {
  if (!AppState.historicalAvailable || !AppState.historicalJds.length) return [];

  const curText = `${currentJd.employer || ''} ${currentJd.title || ''} ${currentJd.text || ''}`.toLowerCase();
  const curTokens = new Set(curText.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 3));

  const scored = [];
  AppState.historicalJds.forEach(hist => {
    let score = 0;
    const histEmp = hist.employer.toLowerCase();
    const histTitle = hist.roleTitle.toLowerCase();

    // 1. Exact or partial company match (weight: 45)
    if (currentJd.employer && histEmp.includes(currentJd.employer.toLowerCase())) {
      score += 45;
    } else if (currentJd.employer && histEmp.length > 3 && currentJd.text.toLowerCase().includes(histEmp)) {
      score += 30;
    }

    // 2. Title token similarity (weight: 35)
    const titleTokens = histTitle.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 3);
    let titleOverlap = 0;
    titleTokens.forEach(t => { if (curTokens.has(t)) titleOverlap++; });
    if (titleTokens.length > 0) {
      score += Math.min(35, (titleOverlap / titleTokens.length) * 35);
    }

    // 3. Category match keywords (weight: 20)
    if (hist.categoryCode === 'A' && /consult|advisory|strategy/i.test(curText)) score += 15;
    else if (hist.categoryCode === 'B' && /product|roadmap|prd/i.test(curText)) score += 15;
    else if (hist.categoryCode === 'C' && /analytics|data science|bi/i.test(curText)) score += 15;
    else if (hist.categoryCode === 'G' && /maintenance|support|staff aug|coding/i.test(curText)) score += 15;

    if (score >= 35) {
      scored.push({ hist, score });
    }
  });

  scored.sort((a, b) => b.score - a.score);

  // Return up to top 2 bounded historical precedents
  return scored.slice(0, 2).map(s => ({
    historicalId: s.hist.id,
    employer: s.hist.employer,
    title: s.hist.roleTitle,
    year: s.hist.year,
    category: s.hist.categoryName,
    fitScore: s.hist.compositeFit,
    ctcRange: s.hist.y1Ctc,
    summaryExcerpt: s.hist.strategicRationale.slice(0, 240) + '...',
  }));
}

// ── Ingestion Handlers (Current JDs) ────────────────────────────────────────
function initFileIngestion() {
  const dropZone = $('#dropZone');
  const fileInput = $('#fileInput');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') fileInput.click();
  });

  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));

  dropZone.addEventListener('drop', async e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer?.files) {
      await handleIncomingFiles([...e.dataTransfer.files]);
    }
  });

  fileInput.addEventListener('change', async () => {
    if (fileInput.files) {
      await handleIncomingFiles([...fileInput.files]);
      fileInput.value = '';
    }
  });

  // Pasted Text Handler
  $('#btnAddPastedJd').addEventListener('click', () => {
    const rawText = $('#pasteJdInput').value.trim();
    if (!rawText) {
      alert('Please paste some job description text first.');
      return;
    }
    const chunks = rawText.split(/^(?:---|JD:)/m).map(c => c.trim()).filter(c => c.length > 40);
    if (chunks.length === 0) chunks.push(rawText);

    let count = 0;
    chunks.forEach(chunk => {
      addIngestedJd({
        filename: `Pasted_JD_${AppState.jds.length + 1}.txt`,
        text: chunk,
        sourceType: 'paste',
      });
      count++;
    });

    $('#pasteJdInput').value = '';
    renderLoadedJdList();
    appendConsoleLog(`Added ${count} pasted JD(s). Total loaded: ${AppState.jds.length}.`);
  });

  // Synthetic Test Fixtures Loader
  const loadFixturesBtn = $('#btnLoadTestFixtures');
  const loadFixturesTopBtn = $('#btnTestFixtureTop');
  const handleLoadFixtures = () => {
    SYNTHETIC_TEST_FIXTURES.forEach(fixture => {
      addIngestedJd({
        filename: fixture.filename,
        employer: fixture.employer,
        title: fixture.title,
        location: fixture.location,
        compensation: fixture.compensation,
        text: fixture.text,
        sourceType: 'fixture',
        isTestFixture: true,
      });
    });
    renderLoadedJdList();
    appendConsoleLog('Loaded 4 synthetic test fixtures (clearly tagged with 🧪 TEST FIXTURE).');
  };
  loadFixturesBtn.addEventListener('click', handleLoadFixtures);
  loadFixturesTopBtn.addEventListener('click', handleLoadFixtures);

  // Clear loaded items
  $('#btnClearLoadedJds').addEventListener('click', () => {
    if (confirm('Remove all currently loaded JDs from memory?')) {
      AppState.jds = [];
      renderLoadedJdList();
      appendConsoleLog('Cleared all loaded JDs.');
    }
  });
}

async function handleIncomingFiles(files) {
  for (const file of files) {
    if (AppState.jds.length >= 100) {
      alert('Maximum capacity of 100 JDs reached. Skipping remaining files.');
      break;
    }

    const ext = file.name.split('.').pop().toLowerCase();
    try {
      if (ext === 'pdf') {
        const text = await parsePdfFile(file);
        addIngestedJd({ filename: file.name, text, sourceType: 'pdf' });
      } else if (ext === 'docx' || ext === 'doc') {
        const text = await parseDocxFile(file);
        addIngestedJd({ filename: file.name, text, sourceType: 'docx' });
      } else if (ext === 'csv' || ext === 'tsv' || ext === 'xlsx') {
        await parseSpreadsheetFile(file, ext);
      } else if (ext === 'json') {
        await parseJsonFile(file);
      } else if (['txt', 'md', 'markdown'].includes(ext)) {
        const text = await readTextFile(file);
        addIngestedJd({ filename: file.name, text, sourceType: 'text' });
      } else {
        appendConsoleLog(`Skipped unsupported file format: ${file.name}`);
      }
    } catch (err) {
      appendConsoleLog(`❌ Error extracting ${file.name}: ${err.message}`);
    }
  }
  renderLoadedJdList();
}

async function parsePdfFile(file) {
  if (typeof pdfjsLib === 'undefined') throw new Error('PDF.js library not loaded');
  const buffer = await file.arrayBuffer();
  const pdfDoc = await pdfjsLib.getDocument({ data: buffer }).promise;
  let fullText = '';
  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const page = await pdfDoc.getPage(p);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(i => i.str).join(' ');
    fullText += `${pageText}\n`;
  }
  if (!fullText.trim()) throw new Error('No selectable text found (OCR for scanned images not supported).');
  return fullText;
}

async function parseDocxFile(file) {
  if (typeof mammoth === 'undefined') throw new Error('mammoth.js library not loaded');
  const buffer = await file.arrayBuffer();
  const res = await mammoth.extractRawText({ arrayBuffer: buffer });
  if (!res.value.trim()) throw new Error('No readable text extracted from document.');
  return res.value;
}

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file contents'));
    reader.readAsText(file);
  });
}

async function parseJsonFile(file) {
  const raw = await readTextFile(file);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON format in file.');
  }

  const items = Array.isArray(parsed) ? parsed : Object.values(parsed);
  let importedCount = 0;
  items.forEach(item => {
    if (typeof item === 'object' && item !== null) {
      const text = item.text || item.description || item.jd || item.job_description || item.responsibilities;
      if (text && typeof text === 'string' && text.trim().length > 40) {
        addIngestedJd({
          filename: file.name,
          employer: item.employer || item.company || '',
          title: item.title || item.role || item.position || '',
          location: item.location || item.city || '',
          compensation: item.compensation || item.ctc || item.salary || '',
          text: text.trim(),
          sourceType: 'json',
        });
        importedCount++;
      }
    }
  });
  appendConsoleLog(`Imported ${importedCount} JD record(s) from ${file.name}.`);
}

async function parseSpreadsheetFile(file, ext) {
  if (typeof XLSX === 'undefined') throw new Error('SheetJS (xlsx) library not loaded');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  if (!rows || rows.length < 2) {
    throw new Error('Spreadsheet must contain at least one header row and one data row.');
  }

  const headers = rows[0].map(h => String(h || '').trim()).filter(Boolean);
  const dataRows = rows.slice(1).filter(r => r && r.length > 0);

  openSpreadsheetMappingModal(file.name, headers, dataRows);
}

function openSpreadsheetMappingModal(filename, headers, dataRows) {
  AppState.activePendingSpreadsheet = { filename, headers, dataRows };

  $('#modalSpreadsheetFilename').textContent = filename;
  $('#modalSpreadsheetRowCount').textContent = dataRows.length;

  const textSelect = $('#mapColText');
  const empSelect = $('#mapColEmployer');
  const titleSelect = $('#mapColTitle');
  const locSelect = $('#mapColLocation');
  const compSelect = $('#mapColComp');

  const selects = [textSelect, empSelect, titleSelect, locSelect, compSelect];
  selects.forEach(sel => {
    sel.innerHTML = '<option value="">-- None / Skip --</option>';
    headers.forEach((h, idx) => {
      sel.innerHTML += `<option value="${idx}">${escapeHtml(h)}</option>`;
    });
  });

  // Heuristic auto-mapping
  headers.forEach((h, idx) => {
    const lower = h.toLowerCase();
    if (/jd|description|responsibilit|role_desc/i.test(lower) && !textSelect.value) textSelect.value = idx;
    else if (/company|employer|client|organization/i.test(lower) && !empSelect.value) empSelect.value = idx;
    else if (/title|role|position|profile/i.test(lower) && !titleSelect.value) titleSelect.value = idx;
    else if (/location|city|place/i.test(lower) && !locSelect.value) locSelect.value = idx;
    else if (/ctc|salary|compensation|package/i.test(lower) && !compSelect.value) compSelect.value = idx;
  });

  if (!textSelect.value && dataRows.length > 0) {
    let longestIdx = 0;
    let maxLen = 0;
    dataRows[0].forEach((val, idx) => {
      const len = String(val || '').length;
      if (len > maxLen) { maxLen = len; longestIdx = idx; }
    });
    textSelect.value = longestIdx;
  }

  updateSpreadsheetPreview();
  selects.forEach(sel => sel.onchange = updateSpreadsheetPreview);
  $('#spreadsheetMappingModal').classList.add('open');
}

function updateSpreadsheetPreview() {
  const pending = AppState.activePendingSpreadsheet;
  if (!pending || pending.dataRows.length === 0) return;

  const row = pending.dataRows[0];
  const textIdx = $('#mapColText').value;
  const empIdx = $('#mapColEmployer').value;
  const titleIdx = $('#mapColTitle').value;
  const locIdx = $('#mapColLocation').value;
  const compIdx = $('#mapColComp').value;

  const previewObj = {
    employer: empIdx !== '' ? row[empIdx] : '(Not mapped)',
    title: titleIdx !== '' ? row[titleIdx] : '(Not mapped)',
    location: locIdx !== '' ? row[locIdx] : '(Not mapped)',
    compensation: compIdx !== '' ? row[compIdx] : '(Not mapped)',
    jdTextSnippet: textIdx !== '' ? String(row[textIdx] || '').slice(0, 180) + '...' : '(Required — select column above)',
  };

  $('#modalRowPreview').textContent = JSON.stringify(previewObj, null, 2);
}

function initSpreadsheetModalButtons() {
  $('#btnCloseSpreadsheetModal').addEventListener('click', closeSpreadsheetModal);
  $('#btnCancelSpreadsheetImport').addEventListener('click', closeSpreadsheetModal);

  $('#btnConfirmSpreadsheetImport').addEventListener('click', () => {
    const pending = AppState.activePendingSpreadsheet;
    if (!pending) return;

    const textIdx = $('#mapColText').value;
    if (textIdx === '') {
      alert('You must select a column for "Job Description Text".');
      return;
    }

    const empIdx = $('#mapColEmployer').value;
    const titleIdx = $('#mapColTitle').value;
    const locIdx = $('#mapColLocation').value;
    const compIdx = $('#mapColComp').value;

    let addedCount = 0;
    let skippedEmpty = 0;

    pending.dataRows.forEach(row => {
      const text = String(row[textIdx] || '').trim();
      if (!text || text.length < 30) {
        skippedEmpty++;
        return;
      }

      addIngestedJd({
        filename: pending.filename,
        employer: empIdx !== '' ? String(row[empIdx] || '').trim() : '',
        title: titleIdx !== '' ? String(row[titleIdx] || '').trim() : '',
        location: locIdx !== '' ? String(row[locIdx] || '').trim() : '',
        compensation: compIdx !== '' ? String(row[compIdx] || '').trim() : '',
        text,
        sourceType: 'spreadsheet',
      });
      addedCount++;
    });

    closeSpreadsheetModal();
    renderLoadedJdList();
    appendConsoleLog(`Imported ${addedCount} row(s) from spreadsheet. (${skippedEmpty} skipped due to empty text).`);
  });
}

function closeSpreadsheetModal() {
  $('#spreadsheetMappingModal').classList.remove('open');
  AppState.activePendingSpreadsheet = null;
}

function addIngestedJd(data) {
  const hash = computeSimpleHash(data.text);
  const isDuplicate = AppState.jds.some(j => j.hash === hash);

  const entry = {
    id: generateId('jd'),
    hash,
    filename: data.filename || 'Pasted_JD',
    employer: data.employer || '',
    title: data.title || '',
    location: data.location || '',
    compensation: data.compensation || '',
    text: data.text || '',
    sourceType: data.sourceType || 'text',
    isTestFixture: Boolean(data.isTestFixture),
    isDuplicate,
    status: 'pending',
    result: null,
  };

  AppState.jds.push(entry);
}

function renderLoadedJdList() {
  const card = $('#loadedJdCard');
  const list = $('#jdItemList');
  const countBadge = $('#badgeJdCount');
  const countText = $('#loadedCountText');
  const dupeBox = $('#duplicateAlertBox');
  const dupeCountText = $('#duplicateCountText');
  const recurrenceBox = $('#historicalRecurrenceAlertBox');
  const recurrenceCountText = $('#historicalRecurrenceCountText');

  const total = AppState.jds.length;
  countBadge.textContent = total;
  countText.textContent = total;

  if (total === 0) {
    card.style.display = 'none';
    list.innerHTML = '';
    return;
  }

  card.style.display = 'block';
  list.innerHTML = '';

  const dupeCount = AppState.jds.filter(j => j.isDuplicate).length;
  if (dupeCount > 0) {
    dupeBox.style.display = 'flex';
    dupeCountText.textContent = dupeCount;
  } else {
    dupeBox.style.display = 'none';
  }

  // Check recurrence against historical database
  let recurrenceCount = 0;
  if (AppState.historicalAvailable) {
    const historicalEmployers = new Set(AppState.historicalJds.map(h => h.employer.toLowerCase()));
    AppState.jds.forEach(j => {
      if (j.employer && historicalEmployers.has(j.employer.toLowerCase())) {
        recurrenceCount++;
      }
    });
  }

  if (recurrenceCount > 0) {
    recurrenceBox.style.display = 'flex';
    recurrenceCountText.textContent = recurrenceCount;
  } else {
    recurrenceBox.style.display = 'none';
  }

  AppState.jds.forEach((jd) => {
    const li = document.createElement('li');
    li.className = 'jd-item-row';

    const testBadge = jd.isTestFixture ? '<span class="test-fixture-badge">🧪 TEST FIXTURE</span>' : '';
    const dupeBadge = jd.isDuplicate ? '<span class="pill" style="background:#fef3c7; color:#92400e;">Duplicate Hash</span>' : '';
    const statusPill = jd.status === 'completed'
      ? '<span class="pill" style="background:#f0fdf4; color:var(--success);">✓ Completed</span>'
      : jd.status === 'failed'
      ? '<span class="pill" style="background:var(--danger-bg); color:var(--danger);">✗ Failed</span>'
      : '<span class="pill" style="background:var(--bg-panel); color:var(--slate);">⏳ Pending</span>';

    const displayName = jd.employer && jd.title
      ? `${jd.employer} — ${jd.title}`
      : jd.filename;

    li.innerHTML = `
      <div class="jd-item-info">
        <span style="font-size:1rem;">📄</span>
        <div style="min-width:0;">
          <div class="jd-item-title">${escapeHtml(displayName)} ${testBadge} ${dupeBadge}</div>
          <div class="jd-item-meta">${escapeHtml(jd.filename)} · ${jd.text.length.toLocaleString()} chars</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:0.5rem;">
        ${statusPill}
        <button class="btn btn-secondary btn-sm btn-edit-jd" data-id="${jd.id}">Edit</button>
        <button class="btn btn-danger btn-sm btn-remove-jd" data-id="${jd.id}">✕</button>
      </div>
    `;

    list.appendChild(li);
  });

  $$('.btn-remove-jd').forEach(btn => {
    btn.addEventListener('click', e => {
      const id = e.currentTarget.dataset.id;
      AppState.jds = AppState.jds.filter(j => j.id !== id);
      renderLoadedJdList();
    });
  });

  $$('.btn-edit-jd').forEach(btn => {
    btn.addEventListener('click', e => {
      const id = e.currentTarget.dataset.id;
      const jd = AppState.jds.find(j => j.id === id);
      if (!jd) return;
      const newText = prompt(`Edit text for ${jd.filename}:`, jd.text);
      if (newText !== null && newText.trim()) {
        jd.text = newText.trim();
        jd.hash = computeSimpleHash(jd.text);
        renderLoadedJdList();
      }
    });
  });
}

// ── Orchestration Pipeline (5 Stages) ───────────────────────────────────────
function initPipelineControls() {
  $('#btnStartAnalysis').addEventListener('click', () => runPipeline(false));
  $('#btnRetryFailed').addEventListener('click', () => runPipeline(true));
  $('#btnCancelAnalysis').addEventListener('click', abortPipeline);
}

function updatePipelineStageUI(activeStageNum, isFailed = false) {
  for (let i = 1; i <= 5; i++) {
    const el = $(`#stage${i}`);
    if (!el) continue;
    el.className = 'stage-item';
    if (i < activeStageNum) el.classList.add('done');
    else if (i === activeStageNum) el.classList.add(isFailed ? 'error' : 'active');
  }
}

function setPipelineProgress(pct, labelText) {
  $('#pipelineProgressFill').style.width = `${pct}%`;
  $('#pipelineProgressPct').textContent = `${Math.round(pct)}%`;
  if (labelText) $('#pipelineProgressLabel').textContent = labelText;
}

function abortPipeline() {
  if (AppState.abortController) {
    AppState.abortController.abort();
    appendConsoleLog('⏹ Cancellation requested by user.');
    $('#analysisStatusLabel').textContent = 'Aborted by user.';
  }
}

async function runPipeline(retryFailedOnly = false) {
  if (!AppState.backendUrl) {
    alert('Backend AI service is not configured. The site owner must set DEFAULT_WORKER_URL in script.js to enable live AI analysis.');
    return;
  }

  const pendingJds = AppState.jds.filter(j => retryFailedOnly ? j.status === 'failed' : j.status !== 'completed');
  if (pendingJds.length === 0) {
    alert(retryFailedOnly ? 'No failed JDs to retry.' : 'No pending JDs to analyze.');
    return;
  }

  const profile = getCandidateProfile();
  const batchSize = parseInt($('#selectBatchSize').value, 10) || 3;
  const modelPreference = $('#selectModelPreference').value;

  AppState.isAnalyzing = true;
  AppState.abortController = new AbortController();

  $('#btnStartAnalysis').disabled = true;
  $('#btnCancelAnalysis').disabled = false;
  $('#btnRetryFailed').style.display = 'none';
  $('#pipelineProgressCard').style.display = 'block';

  appendConsoleLog(`Starting analysis run for ${pendingJds.length} JD(s) in batches of ${batchSize}...`);

  try {
    // ── STAGE 1: Ingest & Normalize ───────────────────────────────────────
    updatePipelineStageUI(1);
    setPipelineProgress(10, 'Stage 1: Normalizing inputs and verifying schema...');
    await new Promise(r => setTimeout(r, 100));

    // ── STAGE 2: Batch Classification & Historical Precedent Search ───────
    updatePipelineStageUI(2);
    setPipelineProgress(20, 'Stage 2: Batch Classification & Historical Precedent Search via Gemini AI...');

    const batches = [];
    for (let i = 0; i < pendingJds.length; i += batchSize) {
      batches.push(pendingJds.slice(i, i + batchSize));
    }

    let completedBatches = 0;
    for (const batch of batches) {
      if (AppState.abortController.signal.aborted) throw new Error('Analysis run cancelled by user.');

      // Find local historical matches for each JD in this batch
      const enrichedBatch = batch.map(j => {
        const histMatches = findHistoricalMatches(j);
        return {
          id: j.id,
          filename: j.filename,
          employer: j.employer,
          title: j.title,
          location: j.location,
          compensation: j.compensation,
          text: j.text,
          historicalMatches: histMatches,
        };
      });

      appendConsoleLog(`Calling /api/analyze-batch with ${batch.length} JD(s)...`);

      const batchPayload = {
        jds: enrichedBatch,
        profile,
        weights: AppState.weights,
        config: { model: modelPreference },
      };

      try {
        const response = await fetch(`${AppState.backendUrl}/api/analyze-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batchPayload),
          signal: AppState.abortController.signal,
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({ error: response.statusText }));
          throw new Error(errData.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        if (!data || !Array.isArray(data.results)) {
          throw new Error('Invalid response structure: missing results array');
        }

        data.results.forEach(res => {
          const matchingJd = AppState.jds.find(j => j.id === res.id);
          if (matchingJd) {
            matchingJd.status = 'completed';
            matchingJd.result = {
              ...res,
              isTestFixture: matchingJd.isTestFixture,
              sourceFilename: matchingJd.filename,
            };
            const existingIdx = AppState.results.findIndex(r => r.id === res.id);
            if (existingIdx !== -1) AppState.results[existingIdx] = matchingJd.result;
            else AppState.results.push(matchingJd.result);
          }
        });

        appendConsoleLog(`✓ Batch completed: ${data.results.length} JDs classified.`);
      } catch (batchErr) {
        appendConsoleLog(`❌ Batch failed: ${batchErr.message}`);
        batch.forEach(j => { j.status = 'failed'; });
      }

      completedBatches++;
      const currentProgress = 20 + Math.round((completedBatches / batches.length) * 45);
      setPipelineProgress(currentProgress, `Stage 2: Processed ${completedBatches}/${batches.length} batches.`);
      renderLoadedJdList();
    }

    const failedCount = AppState.jds.filter(j => j.status === 'failed').length;
    if (failedCount > 0) {
      $('#btnRetryFailed').style.display = 'inline-flex';
      appendConsoleLog(`⚠ ${failedCount} JD(s) failed analysis. You can retry failed batches.`);
    }

    // ── STAGE 3: Validation & Isolation ───────────────────────────────────
    updatePipelineStageUI(3);
    setPipelineProgress(70, 'Stage 3: Validating Category G isolation & constraint flags...');

    // Invariant: Category G roles are strictly flagged
    AppState.results.forEach(r => {
      if (r.category === 'G') {
        r.violatesConstraint = true;
        if (!r.constraintReason) {
          r.constraintReason = 'Classified as Category G (IT Services / Routine Implementation / Bodyshop Trap).';
        }
      }
    });

    // ── STAGE 4: Synthesis & Strategy ─────────────────────────────────────
    updatePipelineStageUI(4);
    setPipelineProgress(80, 'Stage 4: Calling /api/synthesize for executive roadmap...');

    if (AppState.results.length > 0) {
      const synthPayload = {
        results: AppState.results,
        profile,
        weights: AppState.weights,
        config: { model: modelPreference },
      };

      try {
        const synthRes = await fetch(`${AppState.backendUrl}/api/synthesize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(synthPayload),
          signal: AppState.abortController.signal,
        });

        if (synthRes.ok) {
          const synthData = await synthRes.json();
          AppState.summary = synthData.summary;
          AppState.strategy = synthData.strategy;
          AppState.roadmap = synthData.roadmap;
          appendConsoleLog('✓ Synthesis complete. Strategic roadmap generated.');
        } else {
          appendConsoleLog('⚠ Synthesis endpoint returned an error; rendering verified JDs without synthesis.');
        }
      } catch (synthErr) {
        appendConsoleLog(`⚠ Synthesis call failed: ${synthErr.message}`);
      }
    }

    // ── STAGE 5: Final Report & Exports ───────────────────────────────────
    updatePipelineStageUI(5);
    setPipelineProgress(100, 'Stage 5: Complete!');

    renderDashboardResults();
    renderJdTable();
    renderStrategyTab();
    renderRoadmapTab();
    enableExportButtons();

    $('#analysisStatusLabel').textContent = `Complete. Analyzed ${AppState.results.length} JD(s).`;
    appendConsoleLog('🎉 Placement analysis finished successfully.');

    // Switch to Dashboard Tab
    $('[data-tab="tab-dashboard"]').click();
  } catch (err) {
    appendConsoleLog(`❌ Execution stopped: ${err.message}`);
    $('#analysisStatusLabel').textContent = `Stopped: ${err.message}`;
  } finally {
    AppState.isAnalyzing = false;
    AppState.abortController = null;
    $('#btnStartAnalysis').disabled = false;
    $('#btnCancelAnalysis').disabled = true;
  }
}

// ── Rendering: Executive Dashboard (Tab 4) ──────────────────────────────────
function renderDashboardResults() {
  $('#dashEmptyState').style.display = 'none';
  $('#dashActiveContent').style.display = 'block';

  const total = AppState.results.length;
  const countA = AppState.results.filter(r => r.category === 'A').length;
  const countB = AppState.results.filter(r => r.category === 'B').length;
  const countC = AppState.results.filter(r => r.category === 'C').length;
  const countG = AppState.results.filter(r => r.category === 'G').length;

  $('#aggregateStatsCards').innerHTML = `
    <div class="card" style="border-top:3px solid var(--accent);">
      <small>Total Verified Roles (Current)</small>
      <div style="font-size:1.8rem; font-weight:700;">${total}</div>
    </div>
    <div class="card" style="border-top:3px solid var(--cat-a);">
      <small>True Consulting (Cat A)</small>
      <div style="font-size:1.8rem; font-weight:700; color:var(--cat-a);">${countA}</div>
    </div>
    <div class="card" style="border-top:3px solid var(--cat-b);">
      <small>Product Management (Cat B)</small>
      <div style="font-size:1.8rem; font-weight:700; color:var(--cat-b);">${countB}</div>
    </div>
    <div class="card" style="border-top:3px solid var(--cat-g);">
      <small>IT Services Traps (Cat G)</small>
      <div style="font-size:1.8rem; font-weight:700; color:var(--cat-g);">${countG}</div>
    </div>
  `;

  const s = AppState.summary;
  const pathCards = $('#executivePathCards');
  if (s) {
    pathCards.innerHTML = `
      <div class="card" style="background:#f0fdf4; border-color:var(--success-border);">
        <div class="pill" style="background:#dcfce7; color:var(--success); margin-bottom:0.4rem;">🥇 Primary Recommendation</div>
        <h4>${escapeHtml(s.primary?.track || 'N/A')}</h4>
        <small style="font-weight:600; color:var(--navy);">${escapeHtml(s.primary?.subtype || '')}</small>
        <p style="font-size:0.84rem; margin-top:0.4rem;">${escapeHtml(s.primary?.reason || '')}</p>
      </div>
      <div class="card" style="background:#f0f9ff; border-color:#bae6fd;">
        <div class="pill" style="background:#e0f2fe; color:var(--accent); margin-bottom:0.4rem;">🥈 Secondary / Backup</div>
        <h4>${escapeHtml(s.backup?.track || 'N/A')}</h4>
        <small style="font-weight:600; color:var(--navy);">${escapeHtml(s.backup?.subtype || '')}</small>
        <p style="font-size:0.84rem; margin-top:0.4rem;">${escapeHtml(s.backup?.reason || '')}</p>
      </div>
      <div class="card" style="background:#fffbeb; border-color:var(--warn-border);">
        <div class="pill" style="background:#fef3c7; color:var(--warn); margin-bottom:0.4rem;">🛡 Constraint-Safe Insurance</div>
        <h4>${escapeHtml(s.insurance?.track || 'N/A')}</h4>
        <small style="font-weight:600; color:var(--navy);">${escapeHtml(s.insurance?.subtype || '')}</small>
        <p style="font-size:0.84rem; margin-top:0.4rem;">${escapeHtml(s.insurance?.reason || '')}</p>
      </div>
    `;

    $('#execDecisionDrivers').innerHTML = (s.drivers || []).map(d => `<li>${escapeHtml(d)}</li>`).join('');
    $('#execCriticalRisks').innerHTML = (s.risks || []).map(r => `<li>${escapeHtml(r)}</li>`).join('');
    $('#execEvidenceBounds').innerHTML = `ℹ <strong>Evidence Scope:</strong> ${escapeHtml(s.evidenceLimitations || 'Analysis grounded exclusively in uploaded JDs and verified historical archives.')}`;

    const tbody = $('#trackRankingsTable tbody');
    tbody.innerHTML = '';
    (s.rankings || []).forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>#${r.rank || '—'}</strong></td>
        <td><strong>${escapeHtml(r.track)}</strong></td>
        <td>${getScoreBadge(r.earnings)}</td>
        <td>${getScoreBadge(r.prestige)}</td>
        <td>${getScoreBadge(r.fit)}</td>
        <td>${getScoreBadge(r.escape)}</td>
        <td><strong style="color:var(--navy); font-size:1rem;">${typeof r.weighted === 'number' ? r.weighted.toFixed(1) : r.weighted}</strong></td>
        <td style="font-size:0.82rem;">${escapeHtml(r.justification || '')}</td>
      `;
      tbody.appendChild(tr);
    });
  }
}

// ── Rendering: Filterable Current JD Table (Tab 5) ──────────────────────────
function initTableFilters() {
  $('#tableSearchInput').addEventListener('input', renderJdTable);
  $('#tableCategoryFilter').addEventListener('change', renderJdTable);
  $('#tableTrapFilter').addEventListener('change', renderJdTable);
  $('#tableSortSelect').addEventListener('change', renderJdTable);
}

function renderJdTable() {
  const tbody = $('#jdTableBody');
  if (AppState.results.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted); padding:2rem;">No analyzed JDs available.</td></tr>`;
    return;
  }

  const query = $('#tableSearchInput').value.trim().toLowerCase();
  const catFilter = $('#tableCategoryFilter').value;
  const trapFilter = $('#tableTrapFilter').value;
  const sortSelect = $('#tableSortSelect').value;

  let filtered = AppState.results.filter(r => {
    if (catFilter !== 'ALL' && r.category !== catFilter) return false;
    if (trapFilter === 'SAFE_ONLY' && r.category === 'G') return false;
    if (trapFilter === 'TRAPS_ONLY' && r.category !== 'G') return false;

    if (query) {
      const hay = `${r.employer || ''} ${r.title || ''} ${r.evidence || ''} ${r.classificationReason || ''}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (sortSelect === 'FIT_DESC') return (b.profileFit || 0) - (a.profileFit || 0);
    if (sortSelect === 'ESCAPE_DESC') return (b.escapeVelocity || 0) - (a.escapeVelocity || 0);
    if (sortSelect === 'EMPLOYER_ASC') return (a.employer || '').localeCompare(b.employer || '');
    return 0;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted); padding:2rem;">No roles match the selected filter criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  filtered.forEach(r => {
    const isTrap = r.category === 'G';
    const tr = document.createElement('tr');
    if (isTrap) tr.className = 'row-trap';

    const testFixtureTag = r.isTestFixture ? '<span class="test-fixture-badge">TEST</span>' : '';
    const catDef = CATEGORIES[r.category] || { name: 'Unknown', pillCls: 'cat-pill-A' };

    // Historical Precedent Pill
    let histBadge = '<span style="color:var(--text-muted); font-size:0.8rem;">None</span>';
    if (r.historicalComparison?.hasMatch && r.historicalComparison.matchedHistoricalId) {
      histBadge = `<span class="pill-hist" title="Precedent found in GLIM archives">${escapeHtml(r.historicalComparison.matchedHistoricalId.toUpperCase())}</span>`;
    }

    tr.innerHTML = `
      <td><span class="pill ${catDef.pillCls}">${r.category}: ${catDef.name}</span></td>
      <td><strong>${escapeHtml(r.employer || 'Unspecified')}</strong> ${testFixtureTag}</td>
      <td>${escapeHtml(r.title || 'Unspecified')}</td>
      <td style="font-size:0.8rem;">${escapeHtml(r.orientation || '—')}</td>
      <td>${getScoreBadge(r.profileFit, 'Profile Fit')}</td>
      <td>${getScoreBadge(r.competitiveMoat, 'Moat')}</td>
      <td>${getScoreBadge(r.escapeVelocity, 'Escape Velocity')}</td>
      <td>${histBadge}</td>
      <td>
        <button class="btn btn-secondary btn-sm btn-view-jd-detail" data-id="${r.id}">Audit</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  $$('.btn-view-jd-detail').forEach(btn => {
    btn.addEventListener('click', e => {
      const id = e.currentTarget.dataset.id;
      const res = AppState.results.find(r => r.id === id);
      if (res) openJdDetailModal(res);
    });
  });
}

function openJdDetailModal(r) {
  const modal = $('#jdDetailModal');
  const catDef = CATEGORIES[r.category] || { name: 'Unknown', pillCls: 'cat-pill-A' };

  $('#detailModalCategoryPill').className = `pill ${catDef.pillCls}`;
  $('#detailModalCategoryPill').textContent = `${r.category}: ${catDef.name}`;
  $('#detailModalTitle').textContent = `${r.employer || 'Unknown'} — ${r.title || 'Role'}`;

  // Build Historical Precedent Section
  let historicalPrecedentHtml = '';
  if (r.historicalComparison && r.historicalComparison.hasMatch) {
    const rawHistId = r.historicalComparison.matchedHistoricalId?.replace('hist-', '');
    historicalPrecedentHtml = `
      <div class="section-gap" style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:var(--radius-sm); padding:0.85rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.35rem;">
          <h4 style="margin:0; color:var(--navy);">📚 Historical Placement Precedent (${escapeHtml(r.historicalComparison.matchedHistoricalId?.toUpperCase() || '')})</h4>
          ${rawHistId ? `<button class="btn btn-secondary btn-sm btn-jump-to-hist" data-rawid="${rawHistId}">Inspect Source Record [HIST-${rawHistId}]</button>` : ''}
        </div>
        <p style="font-size:0.84rem; margin-bottom:0.3rem;">
          <strong>Comparative Evolution:</strong> ${escapeHtml(r.historicalComparison.comparisonSummary || '')}
        </p>
        ${r.historicalComparison.precedentEvolution ? `<p style="font-size:0.82rem; color:var(--slate-dark); margin:0;"><strong>Shift in Responsibilities:</strong> ${escapeHtml(r.historicalComparison.precedentEvolution)}</p>` : ''}
      </div>
    `;
  } else {
    historicalPrecedentHtml = `
      <div class="section-gap" style="font-size:0.82rem; color:var(--text-muted);">
        📚 <strong>Historical Precedent:</strong> No sufficiently similar historical record in database.
      </div>
    `;
  }

  const content = $('#detailModalContent');
  content.innerHTML = `
    ${r.isTestFixture ? '<div class="alert alert-info" style="font-size:0.82rem;">🧪 <strong>Synthetic Test Fixture:</strong> This is a synthetic role generated for testing and demonstration purposes.</div>' : ''}
    ${r.violatesConstraint ? `<div class="alert alert-danger" style="font-size:0.84rem;">⛔ <strong>Constraint Violation:</strong> ${escapeHtml(r.constraintReason || 'IT Services / Bodyshop Trap')}</div>` : ''}

    <div class="panel-grid-3 section-gap">
      <div class="card">
        <small>Profile Fit Score</small>
        <div style="font-size:1.4rem; font-weight:700;">${r.profileFit ?? '—'} / 10</div>
        <p style="font-size:0.8rem; margin:0.3rem 0 0;">${escapeHtml(r.profileFitReason || '')}</p>
      </div>
      <div class="card">
        <small>Competitive Moat</small>
        <div style="font-size:1.4rem; font-weight:700;">${r.competitiveMoat ?? '—'} / 10</div>
        <p style="font-size:0.8rem; margin:0.3rem 0 0;">${escapeHtml(r.moatReason || '')}</p>
      </div>
      <div class="card">
        <small>Escape Velocity</small>
        <div style="font-size:1.4rem; font-weight:700;">${r.escapeVelocity ?? '—'} / 10</div>
        <p style="font-size:0.8rem; margin:0.3rem 0 0;">${escapeHtml(r.escapeReason || '')}</p>
      </div>
    </div>

    ${historicalPrecedentHtml}

    <div class="section-gap">
      <h4>Classification Rationale:</h4>
      <p style="font-size:0.86rem;">${escapeHtml(r.classificationReason || '—')}</p>
    </div>

    <div class="section-gap">
      <h4>Verified Evidence from JD Text:</h4>
      <blockquote style="border-left:3px solid var(--accent); padding-left:0.75rem; font-style:italic; font-size:0.84rem; background:var(--bg-panel); padding:0.6rem;">
        "${escapeHtml(r.evidence || 'No direct text excerpt provided')}"
      </blockquote>
    </div>

    <div class="panel-grid-2 section-gap">
      <div>
        <h4>Red Flags Detected:</h4>
        <ul style="font-size:0.84rem; padding-left:1rem; color:var(--danger);">
          ${(r.redFlags && r.redFlags.length > 0)
            ? r.redFlags.map(f => `<li>${escapeHtml(f)}</li>`).join('')
            : '<li style="color:var(--text-muted);">None identified</li>'}
        </ul>
      </div>
      <div>
        <h4>Positive Signals:</h4>
        <ul style="font-size:0.84rem; padding-left:1rem; color:var(--success);">
          ${(r.positiveSignals && r.positiveSignals.length > 0)
            ? r.positiveSignals.map(s => `<li>${escapeHtml(s)}</li>`).join('')
            : '<li style="color:var(--text-muted);">None identified</li>'}
        </ul>
      </div>
    </div>

    <div class="section-gap">
      <h4>Role Overview & Assumptions:</h4>
      <p style="font-size:0.84rem;"><strong>Day-to-day:</strong> ${escapeHtml(r.roleDescription || '—')}</p>
      <p style="font-size:0.8rem; color:var(--text-muted);"><strong>Assumptions:</strong> ${escapeHtml(r.assumptions || 'None noted')}</p>
    </div>
  `;

  modal.classList.add('open');

  // Jump to historical modal
  const jumpBtn = $('.btn-jump-to-hist', modal);
  if (jumpBtn) {
    jumpBtn.addEventListener('click', e => {
      const rawId = parseInt(e.currentTarget.dataset.rawid, 10);
      const histRec = AppState.historicalJds.find(h => h.rawId === rawId);
      if (histRec) {
        modal.classList.remove('open');
        openHistoricalDetailModal(histRec);
      }
    });
  }
}

function initDetailModal() {
  $('#btnCloseDetailModal').addEventListener('click', () => {
    $('#jdDetailModal').classList.remove('open');
  });
}

// ── Rendering: Strategy Tab (Tab 6) ─────────────────────────────────────────
function renderStrategyTab() {
  if (!AppState.strategy) return;
  $('#strategyEmptyState').style.display = 'none';
  $('#strategyActiveContent').style.display = 'block';

  const s = AppState.strategy;
  $('#stratAccentureSection').innerHTML = escapeHtml(s.accentureSection || 'Not generated.');
  $('#stratConsultingSubtypes').innerHTML = escapeHtml(s.consultingSubtypes || 'Not generated.');
  $('#stratPmSection').innerHTML = escapeHtml(s.pmAnalysis || 'Not generated.');
  $('#stratAnalyticsSection').innerHTML = escapeHtml(s.analyticsAI || 'Not generated.');
  $('#stratComparativeMatrix').textContent = s.comparativeMatrix || 'No comparative matrix generated.';
}

// ── Rendering: 6-Month Roadmap (Tab 7) ───────────────────────────────────────
function renderRoadmapTab() {
  if (!AppState.roadmap || !Array.isArray(AppState.roadmap)) return;
  $('#roadmapEmptyState').style.display = 'none';
  $('#roadmapActiveContent').style.display = 'block';

  const grid = $('#roadmapGrid');
  grid.innerHTML = '';

  AppState.roadmap.forEach(w => {
    const card = document.createElement('div');
    card.className = 'roadmap-card';
    card.innerHTML = `
      <div class="week-tag">Week ${w.week || '—'}</div>
      <h4>${escapeHtml(w.objective || 'Focus')}</h4>
      <ul>
        ${(w.skills || []).map(s => `<li>${escapeHtml(s)}</li>`).join('')}
      </ul>
      ${w.deliverable ? `<p style="font-size:0.82rem; margin:0.3rem 0;"><strong>Deliverable:</strong> ${escapeHtml(w.deliverable)}</p>` : ''}
      ${w.interviewPrep ? `<p style="font-size:0.82rem; margin:0.3rem 0;"><strong>Interview Prep:</strong> ${escapeHtml(w.interviewPrep)}</p>` : ''}
      ${w.completionCriteria ? `<small style="margin-top:auto; color:var(--text-muted);">✓ ${escapeHtml(w.completionCriteria)}</small>` : ''}
    `;
    grid.appendChild(card);
  });
}

// ── Exports & Downloads (Tab 8) ─────────────────────────────────────────────
function enableExportButtons() {
  $('#btnDownloadJSON').disabled = false;
  $('#btnDownloadCSV').disabled = false;
  $('#btnDownloadMarkdown').disabled = false;
}

function initExportButtons() {
  $('#btnDownloadJSON').addEventListener('click', () => {
    const exportData = {
      generatedAt: new Date().toISOString(),
      candidateProfile: getCandidateProfile(),
      scoringWeights: AppState.weights,
      summary: AppState.summary,
      results: AppState.results,
      strategy: AppState.strategy,
      roadmap: AppState.roadmap,
      historicalDatabaseMetadata: {
        totalHistoricalJds: AppState.historicalJds.length,
        source: 'data/previous_year_jds.json',
        provenanceNotice: 'Historical records represent archival JD references. Scores and CTC figures are pre-computed heuristic baselines, not official college placement statistics. Placement years are inferred or unspecified.',
      },
      _metadata: {
        totalAnalyzed: AppState.results.length,
        trapsDetected: AppState.results.filter(r => r.category === 'G').length,
        disclaimer: 'Grounded exclusively in uploaded JDs and archival GLIM records. No placement statistics or salaries are guaranteed. Category G roles are strictly excluded from positive career recommendations.',
      },
    };
    downloadBlob(JSON.stringify(exportData, null, 2), 'mba_placement_strategy_audit.json', 'application/json');
  });

  $('#btnDownloadCSV').addEventListener('click', () => {
    const cols = [
      'id', 'category', 'employer', 'title', 'location', 'compensation',
      'profileFit', 'competitiveMoat', 'escapeVelocity', 'violatesConstraint',
      'orientation', 'clientFacing', 'confidence', 'isTestFixture', 'historicalMatchId', 'classificationReason',
    ];
    const headerRow = cols.join(',');
    const rows = AppState.results.map(r => {
      return cols.map(c => {
        let val = c === 'historicalMatchId'
          ? (r.historicalComparison?.matchedHistoricalId || '')
          : (r[c] ?? '');
        val = String(val).replace(/"/g, '""');
        return `"${val}"`;
      }).join(',');
    });
    const csvContent = [headerRow, ...rows].join('\n');
    downloadBlob(csvContent, 'verified_campus_jds.csv', 'text/csv');
  });

  $('#btnDownloadMarkdown').addEventListener('click', () => {
    const p = getCandidateProfile();
    const s = AppState.summary;
    let md = `# MBA Placement Strategy Analyst Report\n\n`;
    md += `**Candidate:** ${p.name} | **MBA:** ${p.mba}\n`;
    md += `**Generated:** ${new Date().toLocaleString()}\n\n`;
    md += `> **Data Provenance & Disclaimer:** Evaluated solely against uploaded job descriptions and archival Great Lakes records. Fit scores and CTC ranges are model heuristic estimates, not verified college placement statistics. Category G roles are strictly excluded from positive career recommendations.\n\n`;

    if (s) {
      md += `## 1. Executive Recommendations\n`;
      md += `- **Primary Track:** ${s.primary?.track} (${s.primary?.subtype}) — ${s.primary?.reason}\n`;
      md += `- **Secondary / Backup:** ${s.backup?.track} (${s.backup?.subtype}) — ${s.backup?.reason}\n`;
      md += `- **Constraint-Safe Insurance:** ${s.insurance?.track} (${s.insurance?.subtype}) — ${s.insurance?.reason}\n\n`;
    }

    md += `## 2. Verified Job Descriptions (${AppState.results.length} Roles)\n\n`;
    AppState.results.forEach(r => {
      md += `### ${r.employer || 'Unspecified'} — ${r.title || 'Role'} (${r.category})\n`;
      md += `- **Profile Fit:** ${r.profileFit ?? '—'}/10 | **Moat:** ${r.competitiveMoat ?? '—'}/10 | **Escape:** ${r.escapeVelocity ?? '—'}/10\n`;
      md += `- **Orientation:** ${r.orientation || '—'} | **Client Facing:** ${r.clientFacing || '—'}\n`;
      if (r.historicalComparison?.hasMatch) {
        md += `- **Historical Precedent:** ${r.historicalComparison.matchedHistoricalId} (${r.historicalComparison.comparisonSummary})\n`;
      }
      if (r.category === 'G') md += `- **⛔ WARNING:** Category G IT Services Trap. Constraint violation: ${r.constraintReason}\n`;
      md += `- **Evidence:** "${r.evidence || 'N/A'}"\n\n`;
    });

    downloadBlob(md, 'mba_placement_report.md', 'text/markdown');
  });

  $('#btnPrintReport').addEventListener('click', () => window.print());
  $('#btnPrintTop').addEventListener('click', () => window.print());

  // Global Clear-All
  $('#btnClearAllTop').addEventListener('click', () => {
    if (confirm('Clear all uploaded current-cycle JDs, analysis results, and generated roadmaps? (Historical archives remain loaded).')) {
      AppState.jds = [];
      AppState.results = [];
      AppState.summary = null;
      AppState.strategy = null;
      AppState.roadmap = null;
      renderLoadedJdList();
      $('#dashEmptyState').style.display = 'block';
      $('#dashActiveContent').style.display = 'none';
      $('#strategyEmptyState').style.display = 'block';
      $('#strategyActiveContent').style.display = 'none';
      $('#roadmapEmptyState').style.display = 'block';
      $('#roadmapActiveContent').style.display = 'none';
      $('#pipelineProgressCard').style.display = 'none';
      renderJdTable();
      $('#btnDownloadJSON').disabled = true;
      $('#btnDownloadCSV').disabled = true;
      $('#btnDownloadMarkdown').disabled = true;
      appendConsoleLog('Cleared current-cycle analysis state.');
      $('[data-tab="tab-ingest"]').click();
    }
  });
}

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ── Application Initialization ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initBackendConfig();
  initWeightsControls();
  initFileIngestion();
  initSpreadsheetModalButtons();
  initPipelineControls();
  initHistoricalTableFilters();
  initHistoricalModalButtons();
  initTableFilters();
  initDetailModal();
  initExportButtons();

  // Asynchronously load the historical dataset
  loadHistoricalDatabase();

  appendConsoleLog('MBA Placement Strategy Analyst initialized.');
});
