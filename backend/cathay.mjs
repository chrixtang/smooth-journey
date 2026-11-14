// Cathay Pacific API adapter — mock-first with timeout fallback.
// Interface: writeServiceCodes(booking, codes, remark), getFlightStatus(flightNo, date), getSeatMap(flightNo, date).
import { FIXED_MENU, MEDICAL_CODES, clip, redact } from "./ai.mjs";

const CATHAY_API_URL = String(process.env.CATHAY_API_URL || "").trim();
const CATHAY_API_KEY = String(process.env.CATHAY_API_KEY || "").trim();
export const CATHAY_LIVE = Boolean(CATHAY_API_URL && CATHAY_API_KEY);
const TIMEOUT_MS = Number(process.env.CATHAY_TIMEOUT_MS || 3000);

let fetchImpl = (...args) => fetch(...args);
export function _setCathayFetch(f) { fetchImpl = f; }

export class CathayAdapterError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export function validateBookingCodes(codes, remark = "") {
  if (!Array.isArray(codes) || codes.length === 0) {
    throw new CathayAdapterError(400, "codes_required", "At least one service code is required.");
  }
  const normalized = [];
  let othsCount = 0;
  for (const item of codes) {
    const code = String(typeof item === "string" ? item : (item && item.code) || "").toUpperCase().trim();
    if (!code) continue;
    if (MEDICAL_CODES.includes(code)) {
      throw new CathayAdapterError(400, "medical_clearance_required", "Customer Care will arrange medical clearance");
    }
    if (!FIXED_MENU[code]) {
      throw new CathayAdapterError(400, "off_menu_code", `Code ${code} is not on the fixed service menu.`);
    }
    if (code === "OTHS") {
      othsCount++;
      if (othsCount > 1) throw new CathayAdapterError(400, "too_many_remarks", "Only one short OTHS remark is allowed.");
    }
    const meta = FIXED_MENU[code];
    normalized.push({
      code,
      label: meta.label,
      tier: meta.tier,
      needsStaffConfirmation: !!meta.needsStaffConfirmation
    });
  }
  if (!normalized.length) {
    throw new CathayAdapterError(400, "codes_required", "At least one valid service code is required.");
  }
  const cleanRemark = redact(clip(String(remark || ""), 120));
  return { codes: normalized, remark: cleanRemark };
}

async function callLive(path, options = {}) {
  if (!CATHAY_LIVE) return null;
  const res = await fetchImpl(`${CATHAY_API_URL.replace(/\/$/, "")}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${CATHAY_API_KEY}`,
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`cathay_http_${res.status}`);
  return res.json();
}

export async function writeServiceCodes(booking, codes, remark = "") {
  const { codes: validated, remark: cleanRemark } = validateBookingCodes(codes, remark);
  const bookingRef = clip(String((booking && (booking.ref || booking.pnr || booking.id)) || "CX-DEMO-881"), 24) || "CX-DEMO-881";
  const route = clip(String((booking && booking.route) || "SYD-HKG-LHR"), 24) || "SYD-HKG-LHR";

  if (CATHAY_LIVE) {
    try {
      const live = await callLive(`/bookings/${encodeURIComponent(bookingRef)}/ssr`, {
        method: "POST",
        body: JSON.stringify({ codes: validated.map((c) => c.code), remark: cleanRemark })
      });
      return {
        ok: true,
        source: "live",
        bookingRef,
        route,
        codes: validated,
        remark: cleanRemark,
        writtenAt: new Date().toISOString(),
        remote: live,
        note: ""
      };
    } catch {
      // Fall back to labelled mock data on timeout or upstream error
      return {
        ok: true,
        source: "mock",
        fallback: true,
        bookingRef,
        route,
        codes: validated,
        remark: cleanRemark,
        writtenAt: new Date().toISOString(),
        note: "Cathay API timed out or unavailable; fell back to mock data."
      };
    }
  }

  return {
    ok: true,
    source: "mock",
    fallback: false,
    bookingRef,
    route,
    codes: validated,
    remark: cleanRemark,
    writtenAt: new Date().toISOString(),
    note: "Mock data used (no Cathay hackathon API access)."
  };
}

export async function getFlightStatus(flightNo = "CX 255", date = "") {
  const cleanFlight = clip(String(flightNo || "CX 255").toUpperCase(), 16) || "CX 255";
  const cleanDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : new Date().toISOString().slice(0, 10);

  if (CATHAY_LIVE) {
    try {
      const live = await callLive(`/flights/status?flight=${encodeURIComponent(cleanFlight)}&date=${encodeURIComponent(cleanDate)}`);
      return { ...live, source: "live", note: "" };
    } catch {
      return {
        source: "mock",
        fallback: true,
        flight: cleanFlight,
        date: cleanDate,
        route: "HKG → LHR",
        terminal: "T1",
        gate: "23",
        aircraft: "A350-1000",
        status: "On time",
        note: "Cathay API timed out or unavailable; fell back to mock data."
      };
    }
  }

  return {
    source: "mock",
    fallback: false,
    flight: cleanFlight,
    date: cleanDate,
    route: cleanFlight === "CX 100" ? "SYD → HKG" : "HKG → LHR",
    terminal: "T1",
    gate: "23",
    aircraft: "A350-1000",
    status: "On time",
    note: "Mock data used (no Cathay hackathon API access)."
  };
}

export async function getSeatMap(flightNo = "CX 255", date = "") {
  const cleanFlight = clip(String(flightNo || "CX 255").toUpperCase(), 16) || "CX 255";
  const cleanDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : new Date().toISOString().slice(0, 10);

  if (CATHAY_LIVE) {
    try {
      const live = await callLive(`/flights/seatmap?flight=${encodeURIComponent(cleanFlight)}&date=${encodeURIComponent(cleanDate)}`);
      return { ...live, source: "live", note: "" };
    } catch {
      // fall through to mock
    }
  }

  return {
    source: "mock",
    fallback: CATHAY_LIVE,
    flight: cleanFlight,
    date: cleanDate,
    aircraft: "A350-1000",
    protectedSeats: [
      { seat: "12A", type: "bulkhead", needsBased: true, status: "reserved", note: "Protected bulkhead seat (needs-based)" },
      { seat: "12C", type: "bulkhead", needsBased: true, status: "available", note: "Adjacent companion seat" }
    ],
    swapScenario: {
      swappedAircraft: "B777-300ER",
      bulkheadSeat: "31A",
      bulkheadKept: true,
      note: "Bulkhead kept on B777-300ER; needs manager approval"
    },
    note: CATHAY_LIVE ? "Cathay API timed out or unavailable; fell back to mock data." : "Mock data used (no Cathay hackathon API access)."
  };
}
