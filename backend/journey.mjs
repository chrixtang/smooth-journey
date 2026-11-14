// Server-side shared state for the Smooth Journey multi-stakeholder application.
// Enforces need-to-know per signed-in stakeholder role on the server.
import {
  redact, suggestCodes, draftBrief, draftHelpCard, answerQuestion,
  EVAC_LINE, FIXED_MENU, MEDICAL_CODES
} from "./ai.mjs";
import { writeServiceCodes, getFlightStatus, getSeatMap } from "./cathay.mjs";

export const PERSONAS = {
  leo: {
    id: "leo",
    passenger: "Leo (8)",
    account: "Grace",
    carer: "Daniel",
    route: "SYD → HKG → LHR",
    flight: "CX 100 / CX 255",
    seat: "12A (Bulkhead)",
    defaultText: "Leo is 8 and autistic. Crowds and loud announcements overwhelm him, so a quiet place to wait helps. He needs the bulkhead seat and to board first. Please tell him before you touch him or his bag. He eats gluten-free. No wheelchair needed."
  },
  chan: {
    id: "chan",
    passenger: "Mrs Chan (78)",
    account: "Mrs Chan",
    carer: "Mei",
    route: "HKG → LHR",
    flight: "CX 255",
    seat: "41C",
    defaultText: "Mrs Chan (78) can manage stairs but needs a wheelchair for long distances (WCHR). Hard of hearing in noise, prefers written notes, flying alone."
  }
};

export const STAGES = [
  { name: "Check-in", post: "checkin", where: "HKIA T1 · Aisle J", owner: "Grace Lam", role: "Check-in & transfer desk", time: "21:04" },
  { name: "HKIA Transfer", post: "transfer", where: "HKIA T1 · Transfer desk", owner: "Kelvin Ho", role: "Assistance escort", time: "21:22" },
  { name: "Gate 23", post: "gate", where: "HKIA T1 · Gate 23 quiet area", owner: "Joyce Wong", role: "Gate staff", time: "22:58" },
  { name: "On board", post: "crew", where: "CX 255 · Door L2", owner: "Daniel Yip", role: "Purser (cabin crew)", time: "23:31" },
  { name: "Arrival · Heathrow", post: "arrival", where: "LHR T3 · Aircraft door", owner: "Sam Patel", role: "Heathrow assistance team", time: "05:52" },
  { name: "Arrivals hall", post: "arrival", where: "LHR T3 · Arrivals hall", owner: "Sam Patel", role: "Heathrow assistance team", time: "06:34" }
];

function freshJourney(personaId = "leo") {
  const per = PERSONAS[personaId] || PERSONAS.leo;
  return {
    personaId: per.id,
    profile: {
      rawText: per.defaultText,
      redacted: "",
      status: "none", // none | draft | verified
      savedToMembership: false,
      codes: [],
      summary: "",
      medif: false,
      clearanceStatus: "none",
      medifMessage: "",
      medifWhy: "",
      wheelchairTier: "No wheelchair needed",
      evac: false,
      conditionsRemoved: false,
      source: ""
    },
    booking: {
      booked: false,
      ref: "CX-881",
      route: per.route,
      flight: per.flight,
      seat: per.seat,
      bulkheadProtected: true,
      cathaySource: "mock",
      cathayNote: ""
    },
    plan: {
      confirmed: false,
      version: 1,
      changeNote: "",
      brief: { text: "", status: "none", source: "" },
      helpCard: { lines: [], status: "none", source: "" }
    },
    travel: {
      active: false,
      stage: 0,
      helpRequested: false,
      helpAcked: false,
      crewHelpRequested: false,
      crewHelpAcked: false,
      aircraftSwap: null // null | { status: "pending"|"approved", newAircraft: "B777-300ER", newSeat: "31A", bulkheadKept: true }
    },
    consent: { carer: true, crew: true, ai: true },
    carerUpdates: [],
    accessLog: [],
    chat: []
  };
}

const journeys = {
  leo: freshJourney("leo"),
  chan: freshJourney("chan")
};

function getJ(personaId = "leo") {
  return journeys[personaId] || journeys.leo;
}

function nowTime() {
  // Hong Kong local time (UTC+8) for display
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16);
}

export function getJourneyState(role, personaId = "leo") {
  const j = getJ(personaId);
  const per = PERSONAS[j.personaId];
  const base = { role, persona: per, consent: j.consent, planVersion: j.plan.version, planChange: j.plan.changeNote };

  if (role === "passenger") {
    return {
      ...base,
      profile: j.profile,
      booking: j.booking,
      plan: j.plan,
      travel: j.travel,
      stages: STAGES,
      accessLog: j.accessLog.slice(0, 12),
      chat: j.chat.slice(-10)
    };
  }

  if (role === "carer") {
    // Privacy: Carer NEVER sees service codes, diagnoses, or help-card details
    if (!j.consent.carer) {
      return { ...base, paused: true, updates: [] };
    }
    return {
      ...base,
      paused: false,
      booking: { booked: j.booking.booked, route: j.booking.route, flight: j.booking.flight },
      travel: {
        active: j.travel.active,
        stage: j.travel.stage,
        stageName: j.travel.stage >= STAGES.length ? "Arrivals hall · Complete" : STAGES[j.travel.stage].name,
        aircraftSwap: j.travel.aircraftSwap ? { status: j.travel.aircraftSwap.status } : null
      },
      stages: STAGES.map((s) => ({ name: s.name, owner: s.owner })),
      updates: j.carerUpdates.slice(0, 12)
    };
  }

  if (role === "staff") {
    // Staff see needs, codes, and approved "How to help" card — never diagnoses or raw unredacted PII
    return {
      ...base,
      profile: {
        status: j.profile.status,
        redacted: j.profile.status === "draft" ? j.profile.redacted : "",
        codes: j.profile.codes,
        wheelchairTier: j.profile.wheelchairTier,
        medif: j.profile.medif,
        clearanceStatus: j.profile.clearanceStatus,
        medifMessage: j.profile.medifMessage,
        evac: j.profile.evac
      },
      booking: j.booking,
      helpCard: j.plan.helpCard,
      travel: j.travel,
      stages: STAGES
    };
  }

  if (role === "crew") {
    // Crew see approved brief (or safety-only if consent.crew is off) + meal/seat codes
    return {
      ...base,
      booking: j.booking,
      codes: j.profile.codes,
      evac: j.profile.evac,
      brief: j.consent.crew ? j.plan.brief : { text: j.profile.evac ? EVAC_LINE : "", status: "withheld", source: "policy" },
      helpCard: j.plan.helpCard,
      travel: j.travel
    };
  }

  if (role === "manager") {
    // Duty Manager sees operational status, equipment, and Disruption Guard (no personal health text)
    return {
      ...base,
      booking: { booked: j.booking.booked, flight: j.booking.flight, route: j.booking.route, seat: j.booking.seat, bulkheadProtected: j.booking.bulkheadProtected },
      travel: j.travel,
      stages: STAGES
    };
  }

  return base;
}

export async function doJourneyAction(role, personaId = "leo", body = {}) {
  const j = getJ(personaId);
  const per = PERSONAS[j.personaId];
  const type = body && body.type;

  if (type === "reset") {
    journeys[j.personaId] = freshJourney(j.personaId);
    return getJourneyState(role, j.personaId);
  }

  if (role === "passenger") {
    if (type === "matchProfile") {
      const raw = String(body.text || j.profile.rawText || "").trim();
      const redacted = redact(raw);
      const res = await suggestCodes(redacted, j.consent.ai);
      j.profile = {
        ...j.profile,
        rawText: raw,
        redacted,
        status: "draft",
        codes: res.codes,
        summary: res.summary,
        medif: res.medif,
        clearanceStatus: res.clearanceStatus,
        medifMessage: res.medifMessage,
        medifWhy: res.medifWhy,
        wheelchairTier: res.wheelchairTier,
        evac: res.evac,
        conditionsRemoved: res.conditionsRemoved,
        source: res.source
      };
      j.accessLog.unshift({ t: nowTime(), who: "Travel Needs AI", what: "Mapped redacted needs onto fixed menu" });
    } else if (type === "saveProfile") {
      j.profile.savedToMembership = true;
      j.accessLog.unshift({ t: nowTime(), who: per.account, what: "Saved Travel Needs Profile to membership" });
    } else if (type === "deleteProfile") {
      journeys[j.personaId].profile = freshJourney(j.personaId).profile;
      j.accessLog.unshift({ t: nowTime(), who: per.account, what: "Deleted Travel Needs Profile" });
    } else if (type === "applyAndBook") {
      const codesToWrite = j.profile.codes.map((c) => c.code).filter((c) => FIXED_MENU[c] && !MEDICAL_CODES.includes(c));
      const writeRes = codesToWrite.length
        ? await writeServiceCodes({ ref: j.booking.ref, route: j.booking.route }, codesToWrite, j.profile.summary.slice(0, 100))
        : { source: "mock", note: "Mock data used" };
      j.booking.booked = true;
      j.booking.cathaySource = writeRes.source || "mock";
      j.booking.cathayNote = writeRes.note || "";
      j.plan.confirmed = true;
      const [briefRes, cardRes] = await Promise.all([
        draftBrief(j.profile, j.consent.ai),
        draftHelpCard(j.profile, j.consent.ai)
      ]);
      j.plan.brief = { text: briefRes.text, status: "draft", source: briefRes.source };
      j.plan.helpCard = { lines: cardRes.lines, status: "draft", source: cardRes.source };
      j.carerUpdates.unshift({ t: nowTime(), text: `${per.passenger} booked on ${per.flight}. Assistance plan ready.` });
      j.accessLog.unshift({ t: nowTime(), who: "Cathay Adapter", what: `Written to booking (${j.booking.cathaySource})` });
    } else if (type === "approveBriefAndCard") {
      if (body.briefText) j.plan.brief.text = String(body.briefText).slice(0, 500);
      if (Array.isArray(body.cardLines)) j.plan.helpCard.lines = body.cardLines.slice(0, 3).map((l) => String(l).slice(0, 90));
      j.plan.brief.status = "approved";
      j.plan.helpCard.status = "approved";
      j.accessLog.unshift({ t: nowTime(), who: per.account, what: `Approved v${j.plan.version} crew brief & How to help card` });
    } else if (type === "changePlan") {
      j.plan.version += 1;
      j.plan.changeNote = String(body.note || "Quiet room before boarding").slice(0, 100);
      if (!j.profile.codes.some((c) => c.code === "PREBOARD")) {
        j.profile.codes.push({ code: "PREBOARD", desc: "Quiet room before boarding.", tier: "Pre-boarding", needsStaffConfirmation: false });
      }
      j.plan.brief.status = "draft";
      j.plan.helpCard.status = "draft";
      j.carerUpdates.unshift({ t: nowTime(), text: `${per.account} updated the travel plan (Version ${j.plan.version}).` });
      j.accessLog.unshift({ t: nowTime(), who: per.account, what: `Updated plan to Version ${j.plan.version}: ${j.plan.changeNote}` });
    } else if (type === "startTravel") {
      j.travel.active = true;
      j.travel.stage = 0;
    } else if (type === "requestHelp") {
      // Ground staff own every help request in this three-role demo.
      j.travel.helpRequested = true;
      j.travel.helpAcked = false;
    } else if (type === "consent") {
      const k = body.key;
      if (k in j.consent) j.consent[k] = !j.consent[k];
    } else if (type === "ask") {
      const q = String(body.question || "").trim();
      if (q) {
        j.chat.push({ from: "me", text: q });
        const ans = await answerQuestion(q, [], j.consent.ai);
        j.chat.push({ from: ans.needs_human ? "human" : "ai", text: ans.answer || "Sent to our accessibility specialist.", source: ans.source, confidence: ans.confidence });
      }
    }
  }

  if (role === "staff") {
    if (type === "confirmCodes") {
      j.profile.status = "verified";
      j.profile.redacted = "";
      j.accessLog.unshift({ t: nowTime(), who: "Sandy Leung · Staff", what: "Confirmed fixed-menu codes" });
    } else if (type === "removeCode") {
      const idx = Number(body.index);
      if (j.profile.codes.length > 1 && idx >= 0 && idx < j.profile.codes.length) {
        j.profile.codes.splice(idx, 1);
      }
    } else if (type === "ackHelp") {
      j.travel.helpAcked = true;
    } else if (type === "completeHandover") {
      j.travel.active = true;
      if (j.travel.stage < STAGES.length) {
        const st = STAGES[j.travel.stage];
        j.travel.stage += 1;
        j.travel.helpRequested = false;
        j.travel.helpAcked = false;
        j.carerUpdates.unshift({ t: nowTime(), text: `${per.passenger} completed ${st.name} (${st.owner}).` });
        j.accessLog.unshift({ t: nowTime(), who: st.owner, what: `Scanned card & completed ${st.name}` });
      }
    }
  }

  if (role === "crew") {
    if (type === "ackCrewHelp") {
      j.travel.crewHelpAcked = true;
    } else if (type === "handoverArrival") {
      if (j.travel.stage === 3) {
        j.travel.stage = 4;
        j.carerUpdates.unshift({ t: nowTime(), text: `Handed to the Heathrow team.` });
        j.accessLog.unshift({ t: nowTime(), who: "Daniel Yip · Purser", what: "Handed over to Heathrow arrival team" });
      }
    }
  }

  if (role === "manager") {
    if (type === "simulateSwap") {
      const seatmap = await getSeatMap(j.booking.flight);
      const swap = seatmap.swapScenario || { swappedAircraft: "B777-300ER", bulkheadSeat: "31A", bulkheadKept: true };
      j.travel.aircraftSwap = {
        status: "pending",
        newAircraft: swap.swappedAircraft,
        newSeat: swap.bulkheadSeat,
        bulkheadKept: !!swap.bulkheadKept
      };
      j.carerUpdates.unshift({ t: nowTime(), text: `Aircraft change detected on ${j.booking.flight}. Assistance plan is being re-checked.` });
    } else if (type === "approveSwap") {
      if (j.travel.aircraftSwap) {
        j.travel.aircraftSwap.status = "approved";
        j.booking.seat = `${j.travel.aircraftSwap.newSeat} (Bulkhead kept)`;
        j.carerUpdates.unshift({ t: nowTime(), text: `Duty Manager approved new plan. Bulkhead seat kept.` });
        j.accessLog.unshift({ t: nowTime(), who: "Priya Shah · Duty Manager", what: "Approved aircraft swap plan (Bulkhead kept)" });
      }
    }
  }

  return getJourneyState(role, j.personaId);
}
