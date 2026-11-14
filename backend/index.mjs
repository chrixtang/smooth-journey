// Smooth Journey API — Cloud Run / Node HTTP handler, served at /api/*.
//
// Public:
//   GET  /api/health
//   GET  /api/flights          (HKIA open data)
//   POST /api/ai               (passport, brief, helpCard, ask)
//   POST /api/cathay/write     (Cathay adapter: writeServiceCodes)
//   GET  /api/cathay/flight    (Cathay adapter: getFlightStatus)
//   GET  /api/cathay/seatmap   (Cathay adapter: getSeatMap)
// Role-gated (/api/state, /api/action):
//   Accepts either a Gateway/JWT authorizer claim (in tests) or x-demo-user header.
//
// Privacy: nothing is logged except error types; request content is never logged.
import {
  AI_ENABLED, MODEL_ID, FIXED_MENU, MEDICAL_CODES, MEDICAL_RE,
  redact, clip, converse, parseJSON, passportPrompt, briefPrompt, helpCardPrompt, conciergePrompt,
  cleanPassport, cleanBrief, cleanHelpCard, templateHelpCard, rulesPassport,
  SAFETY_RE, lastAiCostUsd
} from "./ai.mjs";
import { CATHAY_LIVE, CathayAdapterError, writeServiceCodes, getFlightStatus, getSeatMap } from "./cathay.mjs";
import { getState, doAction, seedDemo, AppError } from "./app.mjs";
import { getJourneyState, doJourneyAction } from "./journey.mjs";

export { _setClient } from "./ai.mjs";
export { _setDb, memoryDb } from "./db.mjs";
export { _setCathayFetch } from "./cathay.mjs";

const HKIA_URL = "https://www.hongkongairport.com/flightinfo-rest/rest/flights/past";
let fetchImpl = (...args) => fetch(...args);
export function _setFetch(f) { fetchImpl = f; }

const ROLE_ORDER = ["supervisor", "crew", "staff", "carer", "passenger"];
export function userFromEvent(event) {
  const c = event && event.requestContext && event.requestContext.authorizer && event.requestContext.authorizer.jwt && event.requestContext.authorizer.jwt.claims;
  if (c && c.sub) {
    let g = c["cognito:groups"] || [];
    if (!Array.isArray(g)) g = String(g).replace(/^\[|\]$/g, "").split(/[\s,]+/).filter(Boolean);
    const role = ROLE_ORDER.find((r) => g.includes(r)) || null;
    return { sub: String(c.sub), email: String(c.email || ""), name: String(c.name || ""), role };
  }
  return null;
}

/* ---------------- public demo AI (the /demo page) ---------------- */
async function demoTask(body) {
  const task = body && body.task;
  const allowFallback = body && body.allowFallback !== false;

  if (task === "passport") {
    const rawText = clip(body.text, 1500);
    const text = redact(rawText);
    if (text.length < 5) throw new AppError(400, "text_required");
    if (MEDICAL_RE.test(rawText) && (!AI_ENABLED || body.useAI === false)) {
      return { ...rulesPassport(rawText), source: "rules" };
    }
    if (!AI_ENABLED) {
      if (allowFallback) return { ...rulesPassport(rawText), source: "rules", note: "AI is off; built-in rules used." };
      throw new AppError(503, "ai_disabled");
    }
    const raw = parseJSON(await converse(passportPrompt(text), 800));
    const cleaned = cleanPassport(raw, rawText);
    return cleaned;
  }

  if (task === "brief") {
    if (!AI_ENABLED) throw new AppError(503, "ai_disabled");
    const f = (body && body.facts) || {};
    const codes = (Array.isArray(f.codes) ? f.codes : []).slice(0, 12)
      .map((c) => ({ code: String((c && c.code) || "").toUpperCase().trim(), desc: redact(clip(c && c.desc, 160)) }))
      .filter((c) => FIXED_MENU[c.code] && !MEDICAL_CODES.includes(c.code) && c.desc);
    if (!codes.length) throw new AppError(400, "facts_required");
    return cleanBrief(await converse(briefPrompt(codes, redact(clip(f.summary, 400))), 300), !!f.evac);
  }

  if (task === "helpCard") {
    const f = (body && body.facts) || {};
    const rawCodes = Array.isArray(f.codes) ? f.codes : [];
    for (const c of rawCodes) {
      const code = String((c && c.code) || "").toUpperCase().trim();
      if (code && !FIXED_MENU[code]) throw new AppError(400, "off_menu_code");
      if (MEDICAL_CODES.includes(code)) throw new AppError(400, "medical_clearance_required");
    }
    const codes = rawCodes.slice(0, 12)
      .map((c) => ({ code: String((c && c.code) || "").toUpperCase().trim(), desc: redact(clip(c && c.desc, 160)) }))
      .filter((c) => FIXED_MENU[c.code] && c.desc);
    if (!codes.length) throw new AppError(400, "facts_required");
    if (!AI_ENABLED || body.useAI === false) {
      return { lines: templateHelpCard({ codes }), source: "rules" };
    }
    const lines = cleanHelpCard(await converse(helpCardPrompt(codes, redact(clip(f.summary, 400))), 200));
    return { lines, source: "ai" };
  }

  if (task === "ask") {
    if (!AI_ENABLED) throw new AppError(503, "ai_disabled");
    const q = redact(clip(body.question, 500));
    if (!q) throw new AppError(400, "question_required");
    if (SAFETY_RE.test(q)) return { answer: "This needs a person.", source: null, confidence: 0, needs_human: true };
    const history = (Array.isArray(body.history) ? body.history : []).slice(-4)
      .map((h) => ({ role: h && h.role === "assistant" ? "assistant" : "user", text: redact(clip(h && h.text, 600)) })).filter((h) => h.text);
    return parseJSON(await converse(conciergePrompt(q, history), 400));
  }

  throw new AppError(400, "unknown_task");
}

/* ---------------- HKIA open data ---------------- */
const flightCache = new Map();
function lowerKeys(o) {
  if (Array.isArray(o)) return o.map(lowerKeys);
  if (o && typeof o === "object") { const r = {}; for (const k of Object.keys(o)) r[k.toLowerCase()] = lowerKeys(o[k]); return r; }
  return o;
}
export function yesterdayHK(now = Date.now()) {
  return new Date(now + 8 * 3600e3 - 24 * 3600e3).toISOString().slice(0, 10);
}
export function summariseFlights(json, date) {
  const raw = lowerKeys(json);
  const days = Array.isArray(raw) ? raw : [raw];
  const day = days.find((d) => d && d.date === date) || days[0] || {};
  const list = Array.isArray(day.list) ? day.list : [];
  const hourly = Array(24).fill(0), london = [];
  let total = 0;
  for (const f of list) {
    const nos = (Array.isArray(f && f.flight) ? f.flight : []).map((x) => String((x && x.no) || "").trim()).filter(Boolean);
    if (!nos.length || !/^CX\s?\d/i.test(nos[0])) continue;
    total++;
    const h = parseInt(String(f.time || "").slice(0, 2), 10);
    if (h >= 0 && h < 24) hourly[h]++;
    const dest = (Array.isArray(f.destination) ? f.destination : [f.destination]).filter(Boolean).map(String);
    if (dest.includes("LHR")) london.push({ time: String(f.time || ""), flight: nos[0], terminal: String(f.terminal || ""), aisle: String(f.aisle || ""), gate: String(f.gate || ""), status: String(f.status || "") });
  }
  return { date, total, hourly, london, source: "Airport Authority Hong Kong flight information (DATA.GOV.HK)" };
}
async function flights(dateParam) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam || "") ? dateParam : yesterdayHK();
  const hit = flightCache.get(date);
  if (hit && Date.now() - hit.t < 30 * 60e3) return hit.v;
  const res = await fetchImpl(`${HKIA_URL}?date=${date}&arrival=false&cargo=false&lang=en`, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
  if (!res.ok) throw new AppError(502, "open_data_unavailable");
  const v = summariseFlights(await res.json(), date);
  flightCache.set(date, { t: Date.now(), v });
  return v;
}

/* ---------------- handler ---------------- */
const reply = (statusCode, obj) => ({
  statusCode,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
  body: JSON.stringify(obj)
});

function readBody(event) {
  let raw = event.body || "";
  if (event.isBase64Encoded) raw = Buffer.from(raw, "base64").toString("utf8");
  if (raw.length > 12000) throw new AppError(413, "too_large");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new AppError(400, "bad_json"); }
}

export const handler = async (event) => {
  if (event && event.admin === "seed") return seedDemo(event.users);

  const method = (event && event.requestContext && event.requestContext.http && event.requestContext.http.method) || "GET";
  const path = (event && event.rawPath) || "";
  const qs = (event && event.queryStringParameters) || {};

  try {
    if (path.endsWith("/api/health")) {
      return reply(200, {
        ok: true,
        ai: AI_ENABLED,
        model: MODEL_ID,
        provider: "google-genai",
        cathayMode: CATHAY_LIVE ? "live" : "mock",
        lastAiCostUsd,
        auth: true
      });
    }
    if (path.endsWith("/api/flights") && method === "GET") return reply(200, await flights(qs.date));
    if (path.endsWith("/api/ai") && method === "POST") return reply(200, { result: await demoTask(readBody(event)) });
    if (path.endsWith("/api/cathay/write") && method === "POST") {
      const b = readBody(event);
      return reply(200, await writeServiceCodes(b.booking, b.codes, b.remark));
    }
    if (path.endsWith("/api/cathay/flight") && method === "GET") {
      return reply(200, await getFlightStatus(qs.flight, qs.date));
    }
    if (path.endsWith("/api/cathay/seatmap") && method === "GET") {
      return reply(200, await getSeatMap(qs.flight, qs.date));
    }
    if (path.endsWith("/api/journey/state") && method === "GET") {
      return reply(200, getJourneyState(qs.role || "passenger", qs.persona || "leo"));
    }
    if (path.endsWith("/api/journey/action") && method === "POST") {
      const b = readBody(event);
      return reply(200, await doJourneyAction(b.role || "passenger", b.persona || "leo", b));
    }
    if ((path.endsWith("/api/state") || path.endsWith("/api/action")) && method === "POST") {
      const u = userFromEvent(event);
      if (!u) return reply(401, { error: "sign_in_required" });
      if (!u.role) return reply(403, { error: "no_role" });
      const body = readBody(event);
      if (path.endsWith("/api/state")) return reply(200, await getState(u));
      return reply(200, await doAction(u, body));
    }
    return reply(404, { error: "not_found" });
  } catch (e) {
    if (e instanceof AppError || e instanceof CathayAdapterError) {
      return reply(e.status, { error: e.code, message: e.message });
    }
    console.error("request failed:", (e && e.name) || "Error"); // type only, never content
    const throttled = e && (e.status === 429 || e.name === "ThrottlingException" || e.name === "ServiceQuotaExceededException");
    return reply(throttled ? 429 : 502, { error: throttled ? "rate_limited" : "upstream_error" });
  }
};
