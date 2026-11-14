// Google Gemini AI, privacy filters, fixed-menu rules, medical routing, and rule-based fallbacks.
import { GoogleGenAI } from "@google/genai";

export const MODEL_ID = String(process.env.MODEL_ID || "gemini-2.5-flash").trim();
export const AI_ENABLED = MODEL_ID !== "" && MODEL_ID.toLowerCase() !== "none";

let client = null;
export function _setClient(c) { client = c; } // tests only

function geminiClient() {
  if (client) return client;
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (apiKey) {
    client = new GoogleGenAI({ apiKey });
    return client;
  }
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
  if (project) {
    client = new GoogleGenAI({ vertexai: true, project, location });
    return client;
  }
  // Fallback: try Vertex AI / ADC default if running on Cloud Run
  client = new GoogleGenAI({ vertexai: true, location });
  return client;
}

export let lastAiCostUsd = 0;

/* ---------------- Fixed menu & medical routing ---------------- */
export const MEDICAL_CODES = ["MEDA", "OXYG", "STCR"];
export const MEDICAL_RE = /\b(oxygen|o2|fitness\s+to\s+fly|fit\s+to\s+fly|medif|recent\s+surgery|surgery|operation|hospital\s+stay|stretcher)\b/i;

export const FIXED_MENU = {
  // Right-sized wheelchair tiers (always require staff confirmation)
  WCHR: { label: "Wheelchair for long distances (can manage stairs)", tier: "Wheelchair · long distances", needsStaffConfirmation: true },
  WCHS: { label: "Wheelchair to/from aircraft (cannot manage stairs)", tier: "Wheelchair · no stairs", needsStaffConfirmation: true },
  WCHC: { label: "Full wheelchair assistance to and from seat", tier: "Wheelchair · full assistance", needsStaffConfirmation: true },
  // Mobility equipment
  WCMP: { label: "Own manual/folding wheelchair", tier: "Own wheelchair", needsStaffConfirmation: false },
  WCBD: { label: "Own wheelchair with non-spillable (dry) battery", tier: "Battery wheelchair", needsStaffConfirmation: true },
  WCBW: { label: "Own wheelchair with spillable (wet) battery", tier: "Battery wheelchair", needsStaffConfirmation: true },
  WCLB: { label: "Own wheelchair with lithium-ion battery", tier: "Battery wheelchair", needsStaffConfirmation: true },
  WCOB: { label: "On-board cabin wheelchair", tier: "Cabin wheelchair", needsStaffConfirmation: false },
  // Sensory, cognitive & escort
  MAAS: { label: "Meet and assist", tier: "Meet and assist", needsStaffConfirmation: false },
  DPNA: { label: "Intellectual or developmental disability; needs assistance", tier: "Cognitive / sensory support", needsStaffConfirmation: false },
  DEAF: { label: "Deaf or hard of hearing; prefers written communication", tier: "Hearing support", needsStaffConfirmation: false },
  BLND: { label: "Blind or low vision", tier: "Vision support", needsStaffConfirmation: false },
  SVAN: { label: "Travelling with a service animal in the cabin", tier: "Service animal", needsStaffConfirmation: false },
  // Meal codes
  GFML: { label: "Gluten-free meal", tier: "Special meal", needsStaffConfirmation: false },
  VGML: { label: "Vegan meal", tier: "Special meal", needsStaffConfirmation: false },
  DBML: { label: "Diabetic meal", tier: "Special meal", needsStaffConfirmation: false },
  KSML: { label: "Kosher meal", tier: "Special meal", needsStaffConfirmation: false },
  MOML: { label: "Muslim meal", tier: "Special meal", needsStaffConfirmation: false },
  CHML: { label: "Child meal", tier: "Special meal", needsStaffConfirmation: false },
  // Seat & boarding
  BULKHEAD: { label: "Protected bulkhead seat (needs-based)", tier: "Protected bulkhead seat", needsStaffConfirmation: false },
  SEAT: { label: "Adjacent or aisle seat request", tier: "Seat request", needsStaffConfirmation: false },
  PREBOARD: { label: "Pre-boarding & quiet boarding support", tier: "Pre-boarding", needsStaffConfirmation: false },
  // One short remark
  OTHS: { label: "Other service, described in one short remark", tier: "Short remark", needsStaffConfirmation: false }
};

export const ALLOWED = Object.fromEntries(Object.entries(FIXED_MENU).map(([k, v]) => [k, v.label]));
const MOBILITY = ["WCHR", "WCHS", "WCHC"];
const EVAC_CODES = ["WCHS", "WCHC"];
export const EVAC_LINE = "Will need help in an evacuation.";

const DX = [
  "dementia", "alzheimer", "parkinson", "stroke", "epilepsy", "epileptic",
  "autism", "autistic", "adhd", "diabetes", "diabetic", "cancer",
  "schizophrenia", "bipolar", "depression", "multiple sclerosis", "arthritis",
  "cerebral palsy", "copd", "heart failure", "heart condition", "hiv",
  "down syndrome", "glaucoma", "macular degeneration", "ptsd",
  "anxiety disorder", "panic disorder"
];

export const POLICY = [
  { id: "P1", title: "Own wheelchairs and mobility aids", text: "Your own manual or folding wheelchair is carried free of charge in the hold and does not count towards your baggage allowance. You can usually stay in it until the aircraft door, and we aim to return it to you at the aircraft door on arrival." },
  { id: "P2", title: "Powered wheelchairs and batteries", text: "Powered wheelchairs and mobility aids with batteries need the battery type and size confirmed at least 48 hours before departure. Our specialist team checks every battery request." },
  { id: "P3", title: "When to ask for assistance", text: "Request assistance at least 48 hours before departure so it can be confirmed. Later requests are handled on a best-effort basis." },
  { id: "P4", title: "Seats", text: "Passengers who need mobility assistance cannot sit in emergency exit rows. We suggest aisle seats close to an accessible lavatory." },
  { id: "P5", title: "Wheelchair size and weight", text: "Whether a wheelchair fits depends on its size, its weight and the aircraft's hold door. Send us the dimensions and weight and our team will confirm for your exact flight." },
  { id: "P6", title: "Hearing and communication", text: "Tell us if you prefer written communication. Crew can write messages for you, and live captions of cabin announcements are available in the app on supported flights." },
  { id: "P7", title: "Quiet spaces at the airport", text: "At Hong Kong International Airport you can wait in quieter seating areas near your gate. Your escort can take you there after immigration." },
  { id: "P8", title: "Safety assistant", text: "If you could not unfasten your seatbelt, put on an oxygen mask or life jacket, or understand the safety briefing, a safety assistant must travel with you." },
  { id: "P9", title: "Travelling alone", text: "If you travel alone, a staff member can meet you at the airport before the person dropping you off leaves, and stay with you through each step to the aircraft." }
];

export const SAFETY_RE = /(batter|lithium|oxygen|medic|medicine|pills?\b|insulin|inject|syringe|surg|operation|pregnan|dangerous goods|chest pain|seizure|breathing|breathe|faint)/i;

/* ---------------- privacy filters ---------------- */
export function scrubDx(s, found) {
  let out = String(s || "");
  for (const w of DX) {
    out = out.replace(new RegExp("\\b" + w.replace(/ /g, "\\s+") + "\\w*", "gi"), (m) => {
      if (found) found.push(m.toLowerCase());
      return "[condition]";
    });
  }
  return out;
}
export function dropDx(s, found) {
  return scrubDx(s, found).split(/(?<=[.!?;])\s+/).filter((x) => !/\[condition\]/.test(x)).join(" ").trim();
}
export function redact(text) {
  let t = String(text || "");
  const rules = [
    [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]"],
    [/\b[A-Z]{1,2}\d{6}\s?\(?[0-9A]\)?/g, "[ID number]"],
    [/\b[A-Z]{1,2}\d{7,8}\b/g, "[document number]"],
    [/\+?\d[\d\s()-]{6,}\d/g, "[phone]", (m) => (m.match(/\d/g) || []).length >= 8],
    [/\b(?:Mrs|Mr|Ms|Miss|Mdm|Madam|Dr)\.?\s+[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)*/g, "[name]"],
    [/\(\s*\d{1,3}\s*\)|\baged?\s+\d{1,3}\b|\b\d{1,3}\s*(?:years?[\s-]old|y\/o|yo)\b/gi, "[age]"],
    [/\b\d{1,2}\s*(?:歲|岁)/g, "[age]"]
  ];
  for (const [re, rep, test] of rules) t = t.replace(re, (m) => (test && !test(m) ? m : rep));
  return scrubDx(t);
}
export const clip = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const noTripleQuotes = (s) => s.replace(/"""/g, '"');
const uniq = (a) => [...new Set(a)];

/* ---------------- prompts ---------------- */
export function passportPrompt(redacted) {
  return `You are helping an airline's special assistance team. Map a passenger's description of their travel needs onto ONLY the fixed menu of codes below. A trained staff member checks your suggestion before anything is used.

Rules:
1. Use ONLY these fixed menu codes, with these meanings:
${Object.entries(ALLOWED).map(([c, m]) => "- " + c + ": " + m).join("\n")}
2. NEVER invent a code. Anything off this menu will be rejected. Use at most one OTHS remark (short phrase).
3. Use at most one of WCHR, WCHS and WCHC, and ONLY if wheelchair assistance is actually needed. Do NOT add a wheelchair code if the passenger can walk.
4. Record functional needs only: what help is needed. Never write a medical diagnosis or condition name. List any removed condition words in "removed_diagnoses".
5. Text in square brackets, like [name] or [age], was removed for privacy. Ignore it.
6. "medif" is true only if the text mentions oxygen, fitness to fly, recent surgery or a hospital stay, or a stretcher. NEVER output MEDA, OXYG or STCR in "codes".
7. "evacuation_help" is true if the passenger cannot manage stairs, cannot walk, or could not move through the cabin quickly without help.
8. "safety_assistant" is true only if the passenger could not unfasten their seatbelt, put on an oxygen mask or life jacket, or understand the safety briefing, even with crew help.
9. Write every field in plain English, even if the passenger wrote in Chinese.

Passenger's description:
"""
${noTripleQuotes(redacted)}
"""

Reply with only this JSON, no other text:
{"codes":[{"code":"DPNA","need":"short phrase"}],"plain_summary":"one or two sentences of functional needs, with no names and no diagnoses","medif":false,"medif_reason":"","evacuation_help":false,"safety_assistant":false,"removed_diagnoses":[],"questions_for_staff":[]}`;
}

export function briefPrompt(codes, summary) {
  return `Write a short note for cabin crew about one passenger, using only the facts below.
Rules: at most 60 words. Plain, respectful English. Practical things crew can do. Add nothing that is not in the facts. No names, ages, diagnoses or condition names. Do not mention codes. Write short sentences without a subject, like "Prefers written communication."

Facts:
${codes.map((c) => "- " + c.desc).join("\n")}
- Summary: ${summary || "none"}

Reply with only the note text.`;
}

export function helpCardPrompt(codes, summary) {
  return `Write a "How to help" card for airport and cabin staff using ONLY the confirmed menu items below.
Rules:
- AT MOST 3 short lines (one item per line, no bullet symbols needed).
- Plain, warm, practical English.
- No names, ages, phone numbers, email, ID numbers, diagnoses or condition names.
- Do not mention IATA codes.

Confirmed items:
${codes.map((c) => "- " + c.desc).join("\n")}
- Summary: ${summary || "none"}

Reply with only the 1 to 3 short lines.`;
}

export function conciergePrompt(q, history) {
  const ctx = history.map((h) => (h.role === "assistant" ? "Assistant: " : "Passenger: ") + h.text).join("\n");
  return `You answer questions in an airline's accessibility assistant. Answer ONLY from the policy excerpts below, never from general knowledge. If the excerpts do not clearly answer the question, say you'll pass it to a person and set needs_human to true. At most 60 words. Plain, warm language. Answer in the same language as the question.

Policy excerpts:
${POLICY.map((p) => "[" + p.id + "] " + p.title + ": " + p.text).join("\n")}

${ctx ? "Recent conversation:\n" + ctx + "\n\n" : ""}Question: """${noTripleQuotes(q)}"""

Reply with only this JSON: {"answer":"...","source":"P1","confidence":0,"needs_human":false}
"source" is the one excerpt id you relied on, or null. "confidence" is 0 to 100: how fully the excerpt answers the question.`;
}

/* ---------------- Google Gemini ---------------- */
export async function converse(prompt, maxTokens) {
  const ai = geminiClient();
  const res = await ai.models.generateContent({
    model: MODEL_ID,
    contents: prompt,
    config: {
      maxOutputTokens: maxTokens,
      temperature: 0
    }
  });
  const usage = res && res.usageMetadata;
  if (usage) {
    const inTok = Number(usage.promptTokenCount || 0);
    const outTok = Number(usage.candidatesTokenCount || 0);
    lastAiCostUsd = Number(((inTok * 0.15 + outTok * 0.60) / 1e6).toFixed(6));
  }
  const text = (res && typeof res.text === "string" ? res.text : "").trim();
  if (!text) throw Object.assign(new Error("empty completion"), { name: "EmptyCompletion" });
  return text;
}

export function parseJSON(t) {
  try { return JSON.parse(t); } catch {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = t.indexOf("{"), z = t.lastIndexOf("}");
  if (a >= 0 && z > a) { try { return JSON.parse(t.slice(a, z + 1)); } catch {} }
  throw Object.assign(new Error("model reply was not JSON"), { name: "InvalidJson" });
}

/* ---------------- validation of AI output & medical routing ---------------- */
function enrichCode(code, desc) {
  const meta = FIXED_MENU[code];
  return {
    code,
    desc,
    tier: meta.tier,
    needsStaffConfirmation: !!meta.needsStaffConfirmation
  };
}

export function cleanPassport(r, originalText = "") {
  if (!r || typeof r !== "object" || !Array.isArray(r.codes)) {
    throw Object.assign(new Error("bad shape"), { name: "InvalidShape" });
  }
  const out = [], seen = new Set(), dx = [];
  let mob = null;
  let othsSeen = false;
  let medicalDetected = !!r.medif || MEDICAL_RE.test(originalText);
  let rejectedOffMenu = [];

  for (const c of r.codes.slice(0, 12)) {
    const code = String((c && c.code) || "").toUpperCase().trim();
    if (!code) continue;
    if (MEDICAL_CODES.includes(code)) {
      medicalDetected = true;
      continue; // Medical triggers are NEVER added as booking codes
    }
    if (!FIXED_MENU[code]) {
      rejectedOffMenu.push(code);
      continue;
    }
    if (MOBILITY.includes(code)) { if (mob) continue; mob = code; }
    if (code === "OTHS") { if (othsSeen) continue; othsSeen = true; }
    let need = String((c && c.need) || ALLOWED[code]).replace(/\s+/g, " ").trim().slice(0, 160);
    need = dropDx(need, dx) || ALLOWED[code];
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(enrichCode(code, need));
  }

  if (!out.length && !medicalDetected) {
    throw Object.assign(new Error("no codes"), { name: "InvalidShape" });
  }

  const codes = out.map((c) => c.code);
  const removedDx = uniq([
    ...(Array.isArray(r.removed_diagnoses) ? r.removed_diagnoses.map((x) => String(x).toLowerCase().slice(0, 40)) : []),
    ...dx
  ]);

  const wc = out.find((c) => MOBILITY.includes(c.code));
  return {
    codes: out,
    summary: dropDx(String(r.plain_summary || "").slice(0, 400), removedDx),
    medif: medicalDetected,
    clearanceStatus: medicalDetected ? "clearance needed" : "none",
    medifMessage: medicalDetected ? "Customer Care will arrange medical clearance" : "",
    medifWhy: medicalDetected ? dropDx(String(r.medif_reason || "Medical clearance trigger detected.").slice(0, 200)) : "",
    wheelchairTier: wc ? `${wc.tier} (needs staff confirmation)` : "No wheelchair needed",
    evac: !!r.evacuation_help || codes.some((c) => EVAC_CODES.includes(c)),
    safetyAsst: !!r.safety_assistant,
    conditionsRemoved: removedDx.length > 0,
    rejectedOffMenu,
    questions: (Array.isArray(r.questions_for_staff) ? r.questions_for_staff : [])
      .slice(0, 3)
      .map((q) => dropDx(String(q).slice(0, 160)))
      .filter(Boolean)
  };
}

export function rulesPassport(text) {
  const t = String(text || "").toLowerCase().replace(/[‘’]/g, "'");
  const c = [];
  const noStairs = /(can'?t|cannot|can not|unable to|not able to|no)\s+(manage|climb|do|use|walk up)?\s*(the\s+)?stairs|stairs?\s+(are|is)\s+(hard|difficult|impossible)/.test(t);
  if (/(can'?t|cannot|unable to|not able to)\s+walk\b|immobile|bed-?bound/.test(t)) {
    c.push(enrichCode("WCHC", "Cannot walk. Needs help all the way to and from the seat."));
  } else if (noStairs) {
    c.push(enrichCode("WCHS", "Cannot manage stairs. Can walk short distances, including to the seat."));
  } else if (/long distance|walk far|far distances|tired walking/.test(t)) {
    c.push(enrichCode("WCHR", "Needs a wheelchair for long distances. Can manage stairs."));
  }

  if (/lithium/.test(t)) c.push(enrichCode("WCLB", "Own wheelchair with a lithium-ion battery."));
  else if (/powered|electric wheelchair|power ?chair|mobility scooter/.test(t)) c.push(enrichCode("OTHS", "Powered mobility aid. Battery type to be confirmed."));
  else if (/folding wheelchair|own wheelchair|manual wheelchair|her wheelchair|his wheelchair|their wheelchair|my wheelchair/.test(t)) c.push(enrichCode("WCMP", "Own folding wheelchair. Carried free and returned at the aircraft door."));

  if (/hard of hearing|deaf|hearing|ear defender|loud noise/.test(t)) c.push(enrichCode("DEAF", "Sensitive to noise / prefers written or calm communication."));
  if (/blind|low vision|sight/.test(t)) c.push(enrichCode("BLND", "Blind or low vision."));
  if (/sensory|overwhelm|transition|step[- ]by[- ]step|visual|routine|meltdown|quiet/.test(t)) c.push(enrichCode("DPNA", "Needs calm step-by-step support and a quiet space."));
  if (/pre-?board|board first|board early|quiet room/.test(t)) c.push(enrichCode("PREBOARD", "Pre-boarding and quiet room before boarding."));
  if (/bulkhead|front row|extra space/.test(t)) c.push(enrichCode("BULKHEAD", "Protected bulkhead seat (needs-based)."));
  if (/sit together|next to|adjacent|aisle seat/.test(t)) c.push(enrichCode("SEAT", "Adjacent seat with companion."));
  if (/gluten|gfml/.test(t)) c.push(enrichCode("GFML", "Gluten-free meal."));
  if (/alone|by herself|by himself|by myself|on (her|his|their|my) own|drop (her|him|them|me) off/.test(t)) {
    c.push(enrichCode("MAAS", "Meet and assist through each airport step."));
  }

  const medicalDetected = MEDICAL_RE.test(t);
  if (!c.length && !medicalDetected) {
    c.push(enrichCode("OTHS", "Needs not recognised automatically. Staff to review with the passenger."));
  }

  const codes = c.map((x) => x.code);
  const dx = [];
  scrubDx(text, dx);
  const wc = c.find((x) => MOBILITY.includes(x.code));
  return {
    codes: c,
    summary: c.map((x) => x.desc).join(" "),
    medif: medicalDetected,
    clearanceStatus: medicalDetected ? "clearance needed" : "none",
    medifMessage: medicalDetected ? "Customer Care will arrange medical clearance" : "",
    medifWhy: medicalDetected ? "Medical clearance trigger mentioned (oxygen, surgery, stretcher, or fitness to fly)." : "",
    wheelchairTier: wc ? `${wc.tier} (needs staff confirmation)` : "No wheelchair needed",
    evac: codes.some((x) => EVAC_CODES.includes(x)),
    safetyAsst: false,
    conditionsRemoved: dx.length > 0,
    rejectedOffMenu: [],
    questions: /powered|electric|power ?chair|scooter/.test(t) && !/lithium/.test(t) ? ["What type of battery does the mobility aid use?"] : []
  };
}

const BRIEF_LINES = {
  DEAF: "Prefers written communication. Please write things down; hard of hearing in noise.",
  WCHS: "Cannot manage stairs; can walk short distances in the cabin.",
  WCHR: "Can walk in the cabin and manage stairs; uses a wheelchair for long distances.",
  WCHC: "Cannot walk; needs help to and from the seat.",
  WCMP: "Own folding wheelchair in the hold, to be returned at the aircraft door on arrival.",
  WCOB: "Will need the on-board wheelchair to reach the lavatory.",
  BLND: "Blind or low vision. Offer your arm and describe the layout clockwise.",
  MAAS: "Meet and assist at each step; confirm handover before companion leaves.",
  DPNA: "Give calm, step-by-step notice before transitions; avoid rushing.",
  PREBOARD: "Offer pre-boarding and a quiet waiting area before general boarding.",
  BULKHEAD: "Needs-based bulkhead seat assigned; keep together with companion.",
  SEAT: "Keep companion seated next to passenger.",
  GFML: "Confirm gluten-free meal (GFML) loaded."
};

export function templateBrief(passport) {
  const parts = [];
  for (const c of passport.codes || []) {
    if (BRIEF_LINES[c.code]) parts.push(BRIEF_LINES[c.code]);
    else if (c.code === "OTHS") parts.push(String(c.desc).replace(/\.?$/, "."));
  }
  if (passport.evac) parts.push(EVAC_LINE);
  return uniq(parts).join(" ");
}

export function cleanBrief(t, evac) {
  let s = String(t || "").replace(/^["'“”\s]+|["'“”\s]+$/g, "").replace(/\s+/g, " ").trim();
  s = dropDx(s).slice(0, 700);
  s = s.split(/(?<=[.!?])\s+/).filter((x) => !/evacuat/i.test(x)).join(" ").trim();
  if (evac) s = (s ? s.replace(/\.?$/, ".") + " " : "") + EVAC_LINE;
  if (!s) throw Object.assign(new Error("empty brief"), { name: "EmptyCompletion" });
  return s;
}

const HELP_CARD_LINES = {
  DPNA: "Speak calmly and give one step at a time before any transition.",
  PREBOARD: "Offer quiet waiting space and pre-boarding before crowds.",
  BULKHEAD: "Keep protected bulkhead and companion seat together.",
  SEAT: "Keep companion seated beside the passenger.",
  DEAF: "Use short written notes or calm face-to-face speech.",
  WCHR: "Provide wheelchair for long walks; confirm tier with passenger.",
  WCHS: "Provide wheelchair to aircraft door; no stairs.",
  WCHC: "Provide full wheelchair support to the seat.",
  WCMP: "Tag folding wheelchair for return at aircraft door.",
  MAAS: "Meet at transfer desk and stay until next handover.",
  GFML: "Confirm gluten-free meal is loaded."
};

export function templateHelpCard(passport) {
  const lines = [];
  for (const c of passport.codes || []) {
    if (HELP_CARD_LINES[c.code]) lines.push(HELP_CARD_LINES[c.code]);
    else if (c.code === "OTHS" && c.desc) lines.push(redact(clip(c.desc, 90)));
  }
  const out = uniq(lines).map((l) => dropDx(redact(l)).slice(0, 90)).filter(Boolean).slice(0, 3);
  if (!out.length) return ["Speak calmly and check in with the passenger's companion."];
  return out;
}

export function cleanHelpCard(t) {
  const rawLines = String(t || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .map((l) => dropDx(redact(l)).slice(0, 90).trim())
    .filter(Boolean);
  const out = uniq(rawLines).slice(0, 3);
  if (!out.length) throw Object.assign(new Error("empty help card"), { name: "EmptyCompletion" });
  return out;
}

export function offlineAnswer(q) {
  const t = q.toLowerCase();
  const m = [
    [/weigh|size|dimension|heavy|fit/, "P5", 58],
    [/folding|own wheelchair|bring.*wheelchair|wheelchair.*bring|mobility aid/, "P1", 92],
    [/quiet|calm|noise|noisy|crowd/, "P7", 88],
    [/seat|exit row|aisle|lavatory|toilet/, "P4", 86],
    [/notice|when.*(ask|book|request)|48|deadline/, "P3", 90],
    [/hear|deaf|caption|write/, "P6", 88],
    [/alone|by myself|on my own/, "P9", 88],
    [/safety assistant|companion|escort.*fly/, "P8", 85]
  ];
  for (const [re, id, conf] of m) {
    if (re.test(t)) {
      const p = POLICY.find((x) => x.id === id);
      return { answer: p.text, source: id, confidence: conf, needs_human: conf < 80 };
    }
  }
  return { answer: "I can't answer that from the policies I have, so I'll pass it to a person.", source: null, confidence: 30, needs_human: true };
}

/* ---------------- high-level jobs ---------------- */
export async function suggestCodes(redactedText, useAI) {
  if (useAI && AI_ENABLED) {
    try {
      const p = cleanPassport(parseJSON(await converse(passportPrompt(redactedText), 800)), redactedText);
      return { ...p, source: "ai", note: "" };
    } catch (e) {
      console.error("passport AI failed:", (e && e.name) || "Error");
      return { ...rulesPassport(redactedText), source: "rules", note: "The AI's answer couldn't be used, so the built-in rules were used instead." };
    }
  }
  return { ...rulesPassport(redactedText), source: "rules", note: useAI ? "AI isn't switched on for this site, so the built-in rules were used." : "" };
}

export async function draftBrief(passport, useAI) {
  if (useAI && AI_ENABLED) {
    try {
      const codes = (passport.codes || []).map((c) => ({ code: c.code, desc: redact(clip(c.desc, 160)) }));
      return { text: cleanBrief(await converse(briefPrompt(codes, redact(clip(passport.summary, 400))), 300), passport.evac), source: "ai", note: "" };
    } catch (e) {
      console.error("brief AI failed:", (e && e.name) || "Error");
    }
  }
  return { text: templateBrief(passport), source: "rules", note: "" };
}

export async function draftHelpCard(passport, useAI) {
  if (useAI && AI_ENABLED) {
    try {
      const codes = (passport.codes || [])
        .filter((c) => FIXED_MENU[c.code] && !MEDICAL_CODES.includes(c.code))
        .map((c) => ({ code: c.code, desc: redact(clip(c.desc, 160)) }));
      if (!codes.length) return { lines: templateHelpCard(passport), source: "rules", note: "" };
      const lines = cleanHelpCard(await converse(helpCardPrompt(codes, redact(clip(passport.summary, 400))), 200));
      return { lines, source: "ai", note: "" };
    } catch (e) {
      console.error("helpCard AI failed:", (e && e.name) || "Error");
    }
  }
  return { lines: templateHelpCard(passport), source: "rules", note: "" };
}

export async function answerQuestion(question, history, useAI) {
  const q = redact(clip(question, 500));
  if (!q) return null;
  if (SAFETY_RE.test(q)) return { answer: "", source: null, confidence: 0, needs_human: true, safety: true, live: false };
  if (useAI && AI_ENABLED) {
    try {
      const hist = (Array.isArray(history) ? history : []).slice(-4)
        .map((h) => ({ role: h && h.role === "assistant" ? "assistant" : "user", text: redact(clip(h && h.text, 600)) })).filter((h) => h.text);
      const raw = parseJSON(await converse(conciergePrompt(q, hist), 400));
      if (!raw || typeof raw.answer !== "string" || !raw.answer.trim()) throw Object.assign(new Error("bad"), { name: "InvalidShape" });
      const src = POLICY.some((p) => p.id === raw.source) ? raw.source : null;
      let conf = Math.round(Number(raw.confidence)); if (!isFinite(conf)) conf = 0; conf = Math.max(0, Math.min(100, conf));
      return { answer: raw.answer.trim().slice(0, 600), source: src, confidence: conf, needs_human: !!raw.needs_human || !src || conf < 80, live: true };
    } catch (e) {
      if (e && (e.status === 429 || e.name === "ThrottlingException" || e.name === "ServiceQuotaExceededException")) throw e;
      console.error("ask AI failed:", (e && e.name) || "Error");
    }
  }
  return { ...offlineAnswer(q), live: false };
}
