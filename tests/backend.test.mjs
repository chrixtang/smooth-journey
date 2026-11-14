// Run with: npm test   (Node's built-in test runner; Gemini, Cathay API, and HKIA are mocked)
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.MODEL_ID = "gemini-2.5-flash";
const api = await import("../backend/index.mjs");
const cathay = await import("../backend/cathay.mjs");
const aiMod = await import("../backend/ai.mjs");
api._setDb(api.memoryDb());

/* ---- mocks ---- */
const sent = [];
let replyFor = () => "";
api._setClient({
  models: {
    generateContent: async ({ contents }) => {
      const p = typeof contents === "string" ? contents : JSON.stringify(contents);
      sent.push(p);
      return {
        text: replyFor(p),
        usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40 }
      };
    }
  }
});

const PASSPORT_JSON = JSON.stringify({
  codes: [
    { code: "WCHS", need: "Cannot manage stairs" },
    { code: "WCMP", need: "Own folding wheelchair" },
    { code: "DEAF", need: "Prefers writing" },
    { code: "FAKE", need: "x" },
    { code: "MAAS", need: "Travelling alone" }
  ],
  plain_summary: "Has dementia. Cannot manage stairs.",
  medif: false,
  evacuation_help: true,
  safety_assistant: false,
  removed_diagnoses: [],
  questions_for_staff: []
});

replyFor = (p) => {
  if (p.includes("fixed menu of codes")) return PASSPORT_JSON;
  if (p.includes('"How to help" card')) return "Speak calmly and give one step at a time.\nOffer quiet space before boarding.\nKeep companion seated beside Leo (autism).";
  if (p.includes("cabin crew")) return "Prefers written communication. Cannot manage stairs.";
  return '{"answer":"Yes, free in the hold.","source":"P1","confidence":92,"needs_human":false}';
};

const users = {
  chan: { sub: "u-chan", email: "chan@example.com", name: "Mrs Chan", groups: "[passenger]" },
  mei: { sub: "u-mei", email: "mei@example.com", name: "Mei", groups: "[carer]" },
  alex: { sub: "u-alex", email: "alex@example.com", name: "Alex Wong", groups: "[staff]" },
  dan: { sub: "u-dan", email: "dan@example.com", name: "Daniel Yip", groups: "[crew]" },
  priya: { sub: "u-priya", email: "priya@example.com", name: "Priya Shah", groups: "[supervisor]" },
  nobody: { sub: "u-x", email: "x@example.com", name: "X", groups: "" }
};

async function as(who, path, body) {
  const u = users[who];
  const r = await api.handler({
    rawPath: path,
    requestContext: {
      http: { method: "POST" },
      authorizer: u ? { jwt: { claims: { sub: u.sub, email: u.email, name: u.name, "cognito:groups": u.groups } } } : undefined
    },
    body: JSON.stringify(body || {})
  });
  return { status: r.statusCode, body: JSON.parse(r.body) };
}
const state = async (who) => (await as(who, "/api/state")).body;
const act = (who, body) => as(who, "/api/action", body);

/* ---- public routes ---- */
test("health is public and reports Google Gemini AI", async () => {
  const r = await api.handler({ rawPath: "/api/health", requestContext: { http: { method: "GET" } } });
  const body = JSON.parse(r.body);
  assert.equal(body.ok, true);
  assert.equal(body.ai, true);
  assert.equal(body.provider, "google-genai");
  assert.equal(body.model, "gemini-2.5-flash");
  assert.equal(body.cathayMode, "mock");
});

test("signed-in routes refuse missing sign-in and missing role", async () => {
  assert.equal((await api.handler({ rawPath: "/api/state", requestContext: { http: { method: "POST" } } })).statusCode, 401);
  assert.equal((await as("nobody", "/api/state")).status, 403);
});

/* ---- the whole journey across five roles ---- */
test("full journey: passport, check, booking, brief, handovers, carer, crew, supervisor", async () => {
  assert.equal((await act("chan", { type: "passportSubmit", text: "Mrs Chan (78), phone 9123 4567, can't manage stairs", useAI: true })).status, 400);
  assert.equal((await act("chan", { type: "passportSubmit", text: "Mrs Chan (78) has dementia, phone 9123 4567, can't manage stairs, own folding wheelchair, hard of hearing, flying alone", useAI: true, consent: true })).status, 200);
  for (const leak of ["Chan", "78", "dementia", "9123"]) assert.ok(!sent.at(-1).includes(leak), "leaked to AI: " + leak);
  let s = await state("chan");
  assert.equal(s.passport.status, "draft");
  assert.deepEqual(s.passport.codes.map((c) => c.code), ["WCHS", "WCMP", "DEAF", "MAAS"]);
  assert.ok(!JSON.stringify(s.passport).includes("dementia"));
  assert.equal(s.passport.conditionsRemoved, true);

  assert.equal((await act("chan", { type: "verify", userId: "u-chan" })).status, 403);
  const st = await state("alex");
  assert.equal(st.queue.length, 1);
  assert.ok(!st.queue[0].redacted.includes("9123") && !st.queue[0].redacted.includes("78"));
  assert.equal((await act("alex", { type: "verify", userId: "u-chan", removeCodes: ["3"] })).status, 200);
  s = await state("chan");
  assert.equal(s.passport.status, "verified");
  assert.equal(s.passport.redacted, undefined);
  assert.deepEqual(s.passport.codes.map((c) => c.code), ["WCHS", "WCMP", "DEAF"]);

  assert.equal((await act("chan", { type: "book" })).status, 200);
  s = await state("chan");
  assert.equal(s.trip.brief.status, "draft");
  assert.ok(s.trip.brief.text.endsWith("Will need help in an evacuation."));
  await act("chan", { type: "briefSave", text: "Please write things down." });
  s = await state("chan");
  assert.ok(s.trip.brief.text.includes("Will need help in an evacuation."));
  await act("chan", { type: "briefApprove" });

  const code = (await act("chan", { type: "shareCode" })).body.code;
  assert.equal(code.length, 6);
  assert.equal((await act("mei", { type: "linkCode", code: "ZZZZZZ" })).status, 400);
  assert.equal((await act("mei", { type: "linkCode", code })).status, 200);
  assert.equal((await act("mei", { type: "linkCode", code })).status, 400);
  let m = await state("mei");
  assert.equal(m.following[0].name, "Mrs Chan");
  assert.ok(!JSON.stringify(m).includes("WCHS"), "carer must not see service codes");

  await act("chan", { type: "startTravel" });
  assert.equal((await state("alex")).assigned.length, 1);
  await act("alex", { type: "setPost", post: "gate" });
  assert.equal((await state("alex")).assigned.length, 0);
  assert.equal((await act("alex", { type: "handover", userId: "u-chan" })).status, 403);
  await act("alex", { type: "setPost", post: "checkin" });

  await act("chan", { type: "help" });
  assert.ok((await state("alex")).assigned[0].help);
  await act("alex", { type: "ackHelp", userId: "u-chan" });
  assert.equal((await state("alex")).assigned[0].help, null);

  assert.equal((await act("dan", { type: "handover", userId: "u-chan" })).status, 403);
  for (const post of ["checkin", "security", "gate"]) {
    await act("alex", { type: "setPost", post });
    assert.equal((await act("alex", { type: "handover", userId: "u-chan" })).status, 200);
  }
  m = await state("mei");
  assert.equal(m.following[0].trip.stageName, "On board");
  assert.ok(m.following[0].updates.some((u) => u.text.includes("checked in")));

  let c = await state("dan");
  assert.ok(c.cabin[0].brief.includes("write things down"));
  await act("chan", { type: "consent", key: "crew", value: false });
  c = await state("dan");
  assert.equal(c.cabin[0].brief, null);
  assert.equal(c.cabin[0].evac, true);
  await act("chan", { type: "consent", key: "crew", value: true });

  await act("chan", { type: "help" });
  assert.ok((await state("dan")).cabin[0].help);
  await act("dan", { type: "ackHelp", userId: "u-chan" });
  assert.equal((await act("dan", { type: "handover", userId: "u-chan" })).status, 200);

  const carerId = (await state("chan")).carers[0].id;
  await act("chan", { type: "carerPause", carerId, paused: true });
  m = await state("mei");
  assert.equal(m.following[0].paused, true);
  assert.equal(m.following[0].trip, undefined);
  await act("chan", { type: "carerPause", carerId, paused: false });

  assert.equal((await act("alex", { type: "delay" })).status, 403);
  await act("priya", { type: "delay" });
  assert.equal((await state("chan")).trip.delay.status, "pending");
  await act("priya", { type: "approveDelay" });
  assert.equal((await state("chan")).trip.delay.status, "approved");
  assert.equal((await state("priya")).trips[0].stageName, "Arrival · Heathrow");

  await act("alex", { type: "setPost", post: "arrival" });
  await act("alex", { type: "handover", userId: "u-chan", stage: 4 });
  assert.equal((await act("alex", { type: "handover", userId: "u-chan", stage: 4 })).status, 409);
  await act("alex", { type: "handover", userId: "u-chan", stage: 5 });
  s = await state("chan");
  assert.equal(s.trip.phase, "done");
  assert.ok(s.log.some((l) => l.who === "Alex Wong"));

  assert.ok((await act("chan", { type: "report", kind: "damage", detail: "bent footrest" })).body.ref.startsWith("SJ-"));
  const before = sent.length;
  const a = await act("chan", { type: "ask", question: "Can I bring a lithium battery?" });
  assert.equal(a.body.answer.needs_human, true);
  assert.equal(sent.length, before);
  assert.equal((await act("chan", { type: "ask", question: "Can I bring my folding wheelchair?" })).body.answer.source, "P1");

  await act("chan", { type: "deleteMyData" });
  s = await state("chan");
  assert.equal(s.passport, null);
  assert.equal(s.trip, null);
  assert.equal(s.carers.length, 0);
  assert.equal((await state("mei")).following.length, 0);
});

/* ---- M1: Cathay adapter (mock-first, seatmap, flight status, validation) ---- */
test("M1: Cathay adapter writes standard codes + remark with mock source tag", async () => {
  const res = await api.handler({
    rawPath: "/api/cathay/write",
    requestContext: { http: { method: "POST" } },
    body: JSON.stringify({
      booking: { ref: "CX-881", route: "SYD-HKG-LHR" },
      codes: ["DPNA", "PREBOARD", "BULKHEAD", "OTHS"],
      remark: "Needs calm step-by-step notice"
    })
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.source, "mock");
  assert.equal(body.bookingRef, "CX-881");
  assert.equal(body.codes.length, 4);

  const fl = JSON.parse((await api.handler({ rawPath: "/api/cathay/flight", queryStringParameters: { flight: "CX 255" }, requestContext: { http: { method: "GET" } } })).body);
  assert.equal(fl.source, "mock");
  assert.equal(fl.flight, "CX 255");

  const sm = JSON.parse((await api.handler({ rawPath: "/api/cathay/seatmap", queryStringParameters: { flight: "CX 255" }, requestContext: { http: { method: "GET" } } })).body);
  assert.equal(sm.source, "mock");
  assert.ok(sm.protectedSeats.some((s) => s.needsBased && s.type === "bulkhead"));
});

/* ---- M3: Fixed menu & right-sized tiers ---- */
test("M3: Fixed menu rejects off-menu codes on server and flags wheelchair tiers", async () => {
  const bad = await api.handler({
    rawPath: "/api/cathay/write",
    requestContext: { http: { method: "POST" } },
    body: JSON.stringify({ booking: { ref: "CX-881" }, codes: ["INVENTED_CODE"] })
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(JSON.parse(bad.body).error, "off_menu_code");

  const wc = await cathay.writeServiceCodes({ ref: "CX-881" }, ["WCHR"], "");
  assert.equal(wc.codes[0].needsStaffConfirmation, true);

  const leo = aiMod.rulesPassport("Leo needs a quiet space, pre-boarding, bulkhead seat, and calm step-by-step support.");
  assert.equal(leo.wheelchairTier, "No wheelchair needed");
  assert.ok(!leo.codes.some((c) => ["WCHR", "WCHS", "WCHC"].includes(c.code)));
});

/* ---- M4: Medical routing ---- */
test("M4: Medical triggers (oxygen, stretcher, fitness to fly, recent surgery) are never added", async () => {
  for (const phrase of [
    "needs oxygen on board",
    "requires a stretcher for the flight",
    "had recent surgery last week",
    "needs fitness to fly clearance"
  ]) {
    const r = aiMod.rulesPassport(phrase);
    assert.equal(r.medif, true);
    assert.equal(r.clearanceStatus, "clearance needed");
    assert.equal(r.medifMessage, "Customer Care will arrange medical clearance");
    assert.ok(!r.codes.some((c) => ["OXYG", "MEDA", "STCR"].includes(c.code)), `medical code leaked for: ${phrase}`);
  }

  const medWrite = await api.handler({
    rawPath: "/api/cathay/write",
    requestContext: { http: { method: "POST" } },
    body: JSON.stringify({ booking: { ref: "CX-881" }, codes: ["OXYG"] })
  });
  assert.equal(medWrite.statusCode, 400);
  assert.equal(JSON.parse(medWrite.body).error, "medical_clearance_required");
});

/* ---- M6: "How to help" card ---- */
test("M6: How to help card capped at 3 lines, redacted, and works with AI off", async () => {
  const r = await api.handler({
    rawPath: "/api/ai",
    requestContext: { http: { method: "POST" } },
    body: JSON.stringify({
      task: "helpCard",
      facts: {
        codes: [{ code: "DPNA", desc: "Calm step-by-step support" }, { code: "PREBOARD", desc: "Quiet room before boarding" }],
        summary: "Quiet boarding"
      }
    })
  });
  assert.equal(r.statusCode, 200);
  const res = JSON.parse(r.body).result;
  assert.ok(Array.isArray(res.lines));
  assert.ok(res.lines.length >= 1 && res.lines.length <= 3);
  assert.ok(!res.lines.join(" ").toLowerCase().includes("autism"));

  const offline = await api.handler({
    rawPath: "/api/ai",
    requestContext: { http: { method: "POST" } },
    body: JSON.stringify({
      task: "helpCard",
      useAI: false,
      facts: { codes: [{ code: "DPNA", desc: "Calm support" }, { code: "BULKHEAD", desc: "Bulkhead seat" }] }
    })
  });
  assert.equal(offline.statusCode, 200);
  const offRes = JSON.parse(offline.body).result;
  assert.equal(offRes.source, "rules");
  assert.ok(offRes.lines.length >= 1 && offRes.lines.length <= 3);
});

/* ---- public demo AI + guards ---- */
const pub = (body) => api.handler({
  rawPath: "/api/ai",
  requestContext: { http: { method: "POST" } },
  body: typeof body === "string" ? body : JSON.stringify(body)
});

test("demo AI: whitelist, limits, safety routing, throttling, no content in logs", async () => {
  replyFor = () => PASSPORT_JSON;
  const r = JSON.parse((await pub({ task: "passport", text: "can't manage stairs" })).body).result;
  assert.ok(!r.codes.some((c) => c.code === "FAKE"));
  assert.equal((await pub({ task: "write me a poem" })).statusCode, 400);
  assert.equal((await pub("{oops")).statusCode, 400);
  assert.equal((await pub({ task: "ask", question: "x".repeat(13000) })).statusCode, 413);
  assert.equal(JSON.parse((await pub({ task: "ask", question: "lithium battery?" })).body).result.needs_human, true);
  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.join(" "));
  api._setClient({
    models: {
      generateContent: async () => { throw Object.assign(new Error("slow"), { status: 429, name: "ThrottlingException" }); }
    }
  });
  assert.equal((await pub({ task: "ask", question: "secret seat question" })).statusCode, 429);
  console.error = orig;
  assert.ok(logs.every((l) => !l.includes("secret")));
});

test("flights: parses HKIA open data in either key casing; yesterday in HK time", async () => {
  const sample = [{ date: "2026-11-13", list: [
    { time: "23:50", flight: [{ no: "CX 255", airline: "CPA" }], status: "Dep 00:02", destination: ["LHR"], terminal: "T1", aisle: "J", gate: "23" },
    { time: "09:10", flight: [{ no: "CX 501", airline: "CPA" }], status: "Dep 09:15", destination: ["NRT"] },
    { time: "10:00", flight: [{ no: "BA 32", airline: "BAW" }, { no: "CX 7720", airline: "CPA" }], status: "Dep 10:05", destination: ["LHR"] }
  ]}];
  const upper = JSON.parse(JSON.stringify(sample).replace(/"(\w+)":/g, (m, k) => '"' + k[0].toUpperCase() + k.slice(1) + '":'));
  for (const body of [sample, upper]) {
    const s = api.summariseFlights(body, "2026-11-13");
    assert.equal(s.total, 2);
    assert.equal(s.hourly[23], 1);
    assert.equal(s.london[0].gate, "23");
  }
  assert.equal(api.yesterdayHK(Date.parse("2026-11-14T17:00:00Z")), "2026-11-14");
  assert.equal(api.yesterdayHK(Date.parse("2026-11-14T15:00:00Z")), "2026-11-13");
});
