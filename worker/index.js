/**
 * MBA Placement Strategy Analyst — Cloudflare Worker
 * File: worker/index.js
 *
 * REST Endpoints:
 *   GET  /api/health         — Returns backend availability and model status (zero secrets exposed)
 *   POST /api/analyze-batch  — Classifies and scores a small batch of JDs against candidate profile and historical precedents
 *   POST /api/synthesize     — Generates cross-category strategy, rankings, and 6-month roadmap
 *
 * Server-Side Environment Variables / Secrets:
 *   GEMINI_API_KEY      — (Secret) Google Gemini API key. Set via `wrangler secret put GEMINI_API_KEY`
 *   GEMINI_MODEL        — (Var) Default model, e.g. "gemini-2.0-flash" or "gemini-1.5-flash"
 *   ALLOWED_ORIGINS     — (Var) Comma-separated allowed origins or "*"
 *   KILL_SWITCH         — (Var) Set to "true" to disable new analyses while keeping health check online
 */

const DEFAULT_MODEL = 'gemini-2.0-flash';
const GEMINI_REST_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_BODY_BYTES = 512 * 1024;    // 512 KB request limit
const MAX_JDS_PER_BATCH = 10;         // Conservative batch size to prevent token exhaustion and timeouts

// ── CORS Helper ─────────────────────────────────────────────────────────────
function getCorsHeaders(request, env) {
  const allowedConfig = (env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN || '*').trim();
  const requestOrigin = request.headers.get('Origin') || '';

  let allowOrigin = '';
  if (allowedConfig === '*') {
    allowOrigin = '*';
  } else {
    const list = allowedConfig.split(',').map(s => s.trim().toLowerCase());
    if (list.includes(requestOrigin.toLowerCase())) {
      allowOrigin = requestOrigin;
    }
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-client-version',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function jsonResponse(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      ...cors,
    },
  });
}

function errorResponse(message, code = 'INVALID_REQUEST', status = 400, cors = {}) {
  return jsonResponse({ error: message, code }, status, cors);
}

// ── Main Fetch Router ───────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const cors = getCorsHeaders(request, env);

    // Handle OPTIONS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, ''); // strip trailing slash

    // 1. Health Check
    if (path === '/api/health' || path === '/health') {
      if (request.method !== 'GET') {
        return errorResponse('Method not allowed', 'METHOD_NOT_ALLOWED', 405, cors);
      }
      return handleHealthCheck(env, cors);
    }

    // 2. Analyze Batch
    if (path === '/api/analyze-batch' || (path === '/analyze' && request.method === 'POST')) {
      if (request.method !== 'POST') {
        return errorResponse('Method not allowed', 'METHOD_NOT_ALLOWED', 405, cors);
      }
      return handleAnalyzeBatch(request, env, cors);
    }

    // 3. Synthesize
    if (path === '/api/synthesize') {
      if (request.method !== 'POST') {
        return errorResponse('Method not allowed', 'METHOD_NOT_ALLOWED', 405, cors);
      }
      return handleSynthesize(request, env, cors);
    }

    return errorResponse(`Route not found: ${path}`, 'NOT_FOUND', 404, cors);
  },
};

// ── GET /api/health ─────────────────────────────────────────────────────────
function handleHealthCheck(env, cors) {
  const isKillSwitchActive = String(env.KILL_SWITCH || env.ANALYSIS_DISABLED || '').toLowerCase() === 'true';
  const hasKey = Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim().length > 0);
  const activeModel = env.GEMINI_MODEL || DEFAULT_MODEL;

  let status = 'ready';
  let message = 'Backend is operational and ready to accept requests.';

  if (isKillSwitchActive) {
    status = 'disabled';
    message = 'AI analysis is temporarily disabled by administrative kill switch.';
  } else if (!hasKey) {
    status = 'unconfigured';
    message = 'GEMINI_API_KEY secret is not configured in Cloudflare Worker environment.';
  }

  return jsonResponse({
    status,
    configured: hasKey,
    killSwitchActive: isKillSwitchActive,
    model: activeModel,
    provider: 'Google Gemini',
    maxBatchSize: MAX_JDS_PER_BATCH,
    message,
    version: '2.2.0',
  }, 200, cors);
}

// ── POST /api/analyze-batch ─────────────────────────────────────────────────
async function handleAnalyzeBatch(request, env, cors) {
  // Pre-flight checks
  if (isKillSwitchActive(env)) {
    return errorResponse('AI analysis is temporarily disabled by administrative kill switch.', 'KILL_SWITCH_ACTIVE', 503, cors);
  }
  if (!env.GEMINI_API_KEY) {
    return errorResponse('AI provider not configured. Please set GEMINI_API_KEY secret.', 'NOT_CONFIGURED', 503, cors);
  }

  // Content length check
  const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (contentLength > MAX_BODY_BYTES) {
    return errorResponse(`Request payload exceeds maximum allowed size of ${MAX_BODY_BYTES / 1024} KB.`, 'PAYLOAD_TOO_LARGE', 413, cors);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Malformed JSON in request body.', 'MALFORMED_JSON', 400, cors);
  }

  const { jds, profile, weights, config } = body;
  if (!Array.isArray(jds) || jds.length === 0) {
    return errorResponse('Missing or empty "jds" array in payload.', 'INVALID_PAYLOAD', 400, cors);
  }
  if (jds.length > MAX_JDS_PER_BATCH) {
    return errorResponse(`Batch size exceeds maximum limit of ${MAX_JDS_PER_BATCH} JDs per call.`, 'BATCH_TOO_LARGE', 400, cors);
  }
  if (!profile || typeof profile !== 'object') {
    return errorResponse('Missing "profile" object in payload.', 'INVALID_PAYLOAD', 400, cors);
  }

  const activeModel = sanitizeModelName(config?.model || env.GEMINI_MODEL || DEFAULT_MODEL);

  // Sanitize JD input to prevent prompt runaway
  const cleanJDs = jds.map((j, idx) => ({
    id: String(j.id || `jd-${idx + 1}`).slice(0, 60),
    filename: String(j.filename || 'Unknown').slice(0, 150),
    employer: String(j.employer || '').slice(0, 100),
    title: String(j.title || '').slice(0, 100),
    location: String(j.location || '').slice(0, 100),
    compensation: String(j.compensation || '').slice(0, 100),
    text: String(j.text || '').slice(0, 6000), // bounded context per JD
    historicalMatches: Array.isArray(j.historicalMatches)
      ? j.historicalMatches.slice(0, 3).map(h => ({
          historicalId: String(h.historicalId || ''),
          employer: String(h.employer || '').slice(0, 80),
          title: String(h.title || '').slice(0, 100),
          year: String(h.year || 'Unspecified'),
          category: String(h.category || '').slice(0, 50),
          fitScore: typeof h.fitScore === 'number' ? h.fitScore : null,
          ctcRange: String(h.ctcRange || '').slice(0, 60),
          summaryExcerpt: String(h.summaryExcerpt || '').slice(0, 300),
        }))
      : [],
  }));

  const systemInstruction = `You are an elite MBA Placement Strategy Analyst with 20 years of experience in management consulting, tech consulting, product management, and enterprise hiring in India.
Your mission is to rigorously evaluate campus placement Job Descriptions (JDs), classify them into unambiguous categories, detect IT services/bodyshop traps, compare them against verified historical placement precedents where provided, and score candidate fit using strictly verified text from the JD.

CRITICAL RULES:
1. Grounding: Rely EXCLUSIVELY on the text in the provided JDs, Candidate Profile, and supplied Historical Matches. NEVER invent salary benchmarks, attrition statistics, company reputation details, or placement numbers not in the text. If compensation is not in the JD, output null.
2. Category G Detection: Any role dominated by routine software development, bug fixing, maintenance, ERP implementation/customization, staff augmentation, or outsourcing delivery (even if disguised with titles like "Consultant", "Tech Analyst", "Advisor", or "Architect") MUST be classified as Category G (IT SERVICES TRAP).
3. Constraint Violations: If a role is Category G or involves bodyshop culture, set "violatesConstraint": true and detail the specific reason in "constraintReason". A historical IT services trap must NEVER make a current trap role eligible for positive recommendations.
4. Historical Precedent Comparison:
   - For each JD, inspect "Historical Matches" if provided.
   - If a relevant historical match exists, compare current role requirements with historical precedent. Note differences, salary benchmark context, or role evolution in "historicalComparison".
   - If no historical matches exist or evidence is insufficient, set "historicalComparison": { "hasMatch": false, "matchedHistoricalId": null, "comparisonSummary": "No sufficiently similar historical record in database.", "precedentEvolution": null }.
5. Scoring (1 to 10 scale):
   - profileFit: How well candidate's past experience (Accenture SWE + MBA) aligns with the required responsibilities.
   - competitiveMoat: Defensible differentiation of candidate against generic applicants.
   - escapeVelocity: Departure from IT services/outsourcing delivery (10 = pure strategy/tier-1 product, 1 = routine maintenance).
   Provide evidence-based rationales for every score.
6. You MUST return ONLY valid JSON matching the specified schema. No markdown fences, no conversational prose.`;

  const userPrompt = `CANDIDATE PROFILE:
${formatProfile(profile)}

SCORING WEIGHTS:
${formatWeights(weights)}

CATEGORIES:
A = TRUE CONSULTING (Strategy, management, operational advisory, client-facing business transformation)
B = PRODUCT MANAGEMENT (Software product lifecycle, discovery, PRDs, roadmaps, GTM)
C = ANALYTICS (Business analytics, decision science, commercial data consulting)
D = MARKETING
E = FINANCE
F = OPERATIONS
G = IT SERVICES TRAP (Implementation, staff aug, ERP grunt work, outsourcing delivery, maintenance)

JOB DESCRIPTIONS TO CLASSIFY:
${cleanJDs.map((j, i) => `
=== JD ${i + 1} ===
ID: ${j.id}
Filename: ${j.filename}
Provided Employer: ${j.employer || 'Not specified'}
Provided Title: ${j.title || 'Not specified'}
Provided Location: ${j.location || 'Not specified'}
Provided Compensation: ${j.compensation || 'Not specified'}
Historical Precedents Found in Database:
${j.historicalMatches.length > 0 ? JSON.stringify(j.historicalMatches, null, 2) : 'None found.'}
Full Text:
${j.text}
`).join('\n')}

SCHEMA REQUIREMENT:
Return a JSON object with this exact shape:
{
  "results": [
    {
      "id": "<matching JD ID>",
      "employer": "<detected company or null>",
      "title": "<detected title or null>",
      "location": "<detected location or null>",
      "compensation": "<compensation if explicitly in JD, else null>",
      "category": "<A|B|C|D|E|F|G>",
      "subtype": "<e.g. Technology Strategy, B2B SaaS PM, IT Implementation>",
      "seniority": "<Junior | Mid | Team Lead | Manager | Unspecified>",
      "classificationReason": "<2-3 sentences referencing specific JD duties>",
      "evidence": "<exact phrases from JD supporting the classification>",
      "orientation": "<advisory-heavy | delivery-heavy | balanced | execution-only>",
      "clientFacing": "<high | medium | low | internal-only>",
      "violatesConstraint": <true|false>,
      "constraintReason": "<reason why it violates IT services constraint, or null>",
      "redFlags": ["<specific warning sign found in text>"],
      "positiveSignals": ["<specific positive attribute found in text>"],
      "profileFit": <integer 1-10 or null>,
      "profileFitReason": "<evidence-based rationale>",
      "competitiveMoat": <integer 1-10 or null>,
      "moatReason": "<evidence-based rationale>",
      "escapeVelocity": <integer 1-10 or null>,
      "escapeReason": "<evidence-based rationale>",
      "assumptions": "<missing information or assumptions>",
      "confidence": "<high|medium|low>",
      "roleDescription": "<summary of day-to-day responsibilities based strictly on JD>",
      "historicalComparison": {
        "hasMatch": <true|false>,
        "matchedHistoricalId": "<e.g. hist-12 or null>",
        "comparisonSummary": "<differences/similarities compared to historical precedent, or 'No sufficiently similar historical record in database.'>",
        "precedentEvolution": "<how role responsibilities or compensation have evolved, or null>"
      }
    }
  ]
}`;

  try {
    const rawText = await callGeminiAPI({
      apiKey: env.GEMINI_API_KEY,
      model: activeModel,
      systemInstruction,
      userPrompt,
      timeoutMs: 85000,
    });

    const parsed = cleanAndParseJSON(rawText);
    if (!parsed || !Array.isArray(parsed.results)) {
      return errorResponse('Model returned non-conforming JSON structure (missing "results" array).', 'MODEL_OUTPUT_INVALID', 502, cors);
    }

    return jsonResponse({ results: parsed.results }, 200, cors);
  } catch (err) {
    console.error('Analyze-batch error:', err.message);
    const safeError = sanitizeErrorMessage(err.message);
    return errorResponse(`Analysis failed: ${safeError}`, 'UPSTREAM_AI_ERROR', 502, cors);
  }
}

// ── POST /api/synthesize ────────────────────────────────────────────────────
async function handleSynthesize(request, env, cors) {
  if (isKillSwitchActive(env)) {
    return errorResponse('AI analysis is temporarily disabled by administrative kill switch.', 'KILL_SWITCH_ACTIVE', 503, cors);
  }
  if (!env.GEMINI_API_KEY) {
    return errorResponse('AI provider not configured. Please set GEMINI_API_KEY secret.', 'NOT_CONFIGURED', 503, cors);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Malformed JSON in request body.', 'MALFORMED_JSON', 400, cors);
  }

  const { results, profile, weights, config } = body;
  if (!Array.isArray(results) || results.length === 0) {
    return errorResponse('Missing or empty "results" array in payload.', 'INVALID_PAYLOAD', 400, cors);
  }
  if (!profile || typeof profile !== 'object') {
    return errorResponse('Missing "profile" object in payload.', 'INVALID_PAYLOAD', 400, cors);
  }

  const activeModel = sanitizeModelName(config?.model || env.GEMINI_MODEL || DEFAULT_MODEL);

  // Filter out Category G from positive recommendations
  const eligibleRoles = results.filter(r => r.category !== 'G');
  const trapRoles = results.filter(r => r.category === 'G');

  // Compute deterministic statistics
  const totalAnalyzed = results.length;
  const categoryCounts = {};
  ['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach(c => { categoryCounts[c] = 0; });
  results.forEach(r => {
    if (categoryCounts[r.category] !== undefined) categoryCounts[r.category]++;
  });

  const systemInstruction = `You are a Chief Placement Strategy Advisor.
Synthesize verified JD analysis results into an actionable career roadmap, cross-track comparison, and placement strategy for an MBA candidate.

CRITICAL RULES:
1. Category G roles (IT Services Traps) MUST NEVER be recommended in primary, backup, or insurance recommendations.
2. Ground all insights in the supplied candidate profile and analyzed JDs.
3. Distinguish verified observations from strategic judgment.
4. Do NOT fabricate placement percentage rates or external market salaries not verified by the JDs.
5. Output ONLY valid JSON matching the schema.`;

  const userPrompt = `CANDIDATE PROFILE:
${formatProfile(profile)}

WEIGHTING FORMULA:
${formatWeights(weights)}

DATASET OVERVIEW:
Total JDs Analyzed: ${totalAnalyzed}
Category Counts: ${JSON.stringify(categoryCounts)}
Category G (Traps Detected): ${trapRoles.length} roles (${trapRoles.map(t => `${t.employer || 'Unknown'} - ${t.title || 'Role'}`).slice(0, 15).join('; ')})

ELIGIBLE ROLES (Categories A, B, C, D, E, F):
${JSON.stringify(eligibleRoles.slice(0, 40).map(r => ({
  id: r.id,
  employer: r.employer,
  title: r.title,
  category: r.category,
  subtype: r.subtype,
  profileFit: r.profileFit,
  competitiveMoat: r.competitiveMoat,
  escapeVelocity: r.escapeVelocity,
  orientation: r.orientation,
  clientFacing: r.clientFacing,
  hasHistoricalMatch: r.historicalComparison?.hasMatch || false,
})))}

TASK:
1. Recommend Primary Track, Backup Track, and Insurance Track (strictly non-Category-G).
2. Rank the 6 core tracks: Consulting, Product Management, Analytics, Marketing, Finance, Operations.
3. Conduct Cross-Category Strategic Analysis:
   - "The Accenture Advantage vs. The Accenture Trap" (leveraging 4.5y SWE vs pigeonholing).
   - Consulting Subtypes (Strategy vs Tech Consulting vs Digital Transformation).
   - Product Management and Solution PM viability.
   - Analytics & AI Strategy track viability.
   - Comparative Matrix comparing Consulting vs PM vs Analytics across 5 dimensions.
4. Provide a 24-week (6-Month) week-by-week placement preparation plan tailored to the candidate's top tracks.

SCHEMA REQUIREMENT:
Return this JSON structure:
{
  "summary": {
    "primary": { "track": "<Track Name>", "subtype": "<Subtype>", "reason": "<Evidence-backed reason>" },
    "backup": { "track": "<Track Name>", "subtype": "<Subtype>", "reason": "<Evidence-backed reason>" },
    "insurance": { "track": "<Track Name>", "subtype": "<Subtype>", "reason": "<Strictly non-Category-G safe track>" },
    "drivers": ["<key decision driver 1>", "<driver 2>", "<driver 3>"],
    "risks": ["<key risk 1>", "<risk 2>"],
    "evidenceLimitations": "<Clear statement on dataset bounds>",
    "rankings": [
      {
        "rank": 1,
        "track": "Consulting",
        "earnings": <1-10>,
        "prestige": <1-10>,
        "fit": <1-10>,
        "escape": <1-10>,
        "weighted": <number 1-10 calculated from weights>,
        "justification": "<concise reason>"
      }
    ]
  },
  "strategy": {
    "accentureSection": "<Detailed assessment of Accenture advantage vs trap>",
    "consultingSubtypes": "<Strategy vs Tech Consulting vs Implementation breakdown>",
    "pmAnalysis": "<B2B SaaS PM vs Solutions PM analysis for candidate>",
    "analyticsAI": "<Analytics and GenAI advisory opportunities>",
    "riskAdjusted": "<Risk-adjusted career return comparison>",
    "comparativeMatrix": "<Comparison of Consulting vs PM vs Analytics across 5 dimensions>",
    "evidenceLimitations": "<Observations on missing fields and scope>"
  },
  "roadmap": [
    {
      "week": 1,
      "objective": "<Focus of the week>",
      "skills": ["<Skill 1>", "<Skill 2>"],
      "deliverable": "<Tangible artifact produced>",
      "interviewPrep": "<Specific interview practice>",
      "networking": "<Actionable outreach step>",
      "completionCriteria": "<Checklist to verify completion>"
    }
  ]
}`;

  try {
    const rawText = await callGeminiAPI({
      apiKey: env.GEMINI_API_KEY,
      model: activeModel,
      systemInstruction,
      userPrompt,
      timeoutMs: 95000,
    });

    const parsed = cleanAndParseJSON(rawText);
    if (!parsed || !parsed.summary) {
      return errorResponse('Model returned non-conforming synthesis JSON.', 'MODEL_OUTPUT_INVALID', 502, cors);
    }

    return jsonResponse(parsed, 200, cors);
  } catch (err) {
    console.error('Synthesize error:', err.message);
    const safeError = sanitizeErrorMessage(err.message);
    return errorResponse(`Synthesis failed: ${safeError}`, 'UPSTREAM_AI_ERROR', 502, cors);
  }
}

// ── Google Gemini Official REST API Caller ──────────────────────────────────
async function callGeminiAPI({ apiKey, model, systemInstruction, userPrompt, timeoutMs = 80000 }) {
  const url = `${GEMINI_REST_BASE}/${model}:generateContent`;

  const payload = {
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.15,
      responseMimeType: 'application/json',
      maxOutputTokens: 8192,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey, // API Key in header, never in URL
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (fetchErr) {
    clearTimeout(timer);
    if (fetchErr.name === 'AbortError') {
      throw new Error(`Upstream Gemini API timed out after ${timeoutMs / 1000}s`);
    }
    throw new Error(`Upstream network error reaching Gemini API: ${fetchErr.message}`);
  }
  clearTimeout(timer);

  if (!response.ok) {
    let errBody = '';
    try {
      const errJson = await response.json();
      errBody = errJson?.error?.message || response.statusText;
    } catch {
      errBody = await response.text().catch(() => response.statusText);
    }

    if (response.status === 429) {
      throw new Error('Gemini API rate limit reached. Please wait a moment before retrying.');
    }
    if (response.status === 403 || response.status === 401) {
      throw new Error('Invalid or unauthenticated Gemini API key. Check backend secrets.');
    }
    if (response.status === 404) {
      throw new Error(`Configured Gemini model (${model}) was not found or is unavailable.`);
    }

    throw new Error(`Gemini API error (HTTP ${response.status}): ${errBody.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini API returned an empty completion.');
  }

  return text;
}

// ── Utility Functions ───────────────────────────────────────────────────────
function isKillSwitchActive(env) {
  return String(env.KILL_SWITCH || env.ANALYSIS_DISABLED || '').toLowerCase() === 'true';
}

function sanitizeModelName(model) {
  const allowed = [
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-2.0-flash-lite',
  ];
  return allowed.includes(model) ? model : DEFAULT_MODEL;
}

function sanitizeErrorMessage(msg) {
  return String(msg || '')
    .replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=***')
    .replace(/AIza[a-zA-Z0-9_\-]+/gi, 'AIza***')
    .slice(0, 250);
}

function cleanAndParseJSON(raw) {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Attempt relaxed recovery of inner JSON
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.substring(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function formatProfile(p) {
  return `- Candidate Name: ${p.name || 'MBA Candidate'}
- MBA College: ${p.mba || 'Great Lakes Institute of Management, Chennai'}
- Prior Experience: ${p.prevExp || '4+ years in Technology & Solutions'}
- Experience Areas: ${p.expAreas || 'Solution architecture, client stakeholder management, project scoping, delivery execution, coding'}
- Academics: Class 10: ${p.class10 || '90'}%, Class 12: ${p.class12 || '90'}%, Graduation: ${p.btech || '75'}%
- Core Strengths: ${p.strengths || 'Translating tech to business, solutioning, delivery execution, client communication'}
- Career Inclination: ${p.inclination || 'Technology strategy and digital transformation consulting'}
- HARD CONSTRAINT: ${p.constraint || 'Wants to permanently leave IT services, staff augmentation, and bodyshop culture'}
- Unacceptable Roles: ${p.unacceptable || 'Staff augmentation, implementation-heavy ERP delivery, routine coding and maintenance, outsourcing disguised as consulting'}
- Preferred Geography: ${p.geo || 'India, flexible across cities'}`;
}

function formatWeights(w) {
  const w1 = w?.w1 ?? 30;
  const w2 = w?.w2 ?? 25;
  const w3 = w?.w3 ?? 25;
  const w4 = w?.w4 ?? 20;
  return `5-Year Earning Potential: ${w1}% | Employer Prestige: ${w2}% | Profile Fit: ${w3}% | IT-Services Escape Velocity: ${w4}%`;
}
