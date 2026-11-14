# E394 – Nevada · Smooth Journey

**Team:** Chris, Ruthvik, Ingram, Abi

## Links

- **Live app (Google Cloud Run):** https://REPLACE-WITH-YOUR-CLOUD-RUN-URL
- **Interactive demo:** https://REPLACE-WITH-YOUR-CLOUD-RUN-URL/demo.html
- **Codebase:** https://github.com/chrixtang/smooth-journey
- **Fallback video:** https://REPLACE-WITH-YOUR-FALLBACK-VIDEO-LINK

## Demo accounts

Password for all: `SmoothDemo2026`. They're also one-tap buttons on the welcome screen.

| Role | Email |
|---|---|
| Passenger (Mrs Chan) | mrs.chan@example.com |
| Carer (Mei) | mei@example.com |
| Ground staff | staff@example.com |
| Cabin crew | crew@example.com |
| Supervisor | supervisor@example.com |

You can also create your own passenger or carer account with any email address.

## Try it in 3 minutes (best with three phones)

1. **Phone 1 – Passenger (Mrs Chan):** Trip → **Start travel day**. Press "I'm here. Where's my help?"
2. **Phone 2 – Staff:** My post shows Mrs Chan and her help request. Tap **On my way**, then **confirm handover**. Switch post to Security, then Gate, and confirm each.
3. **Phone 3 – Carer (Mei):** watch each step arrive by itself.
4. **Crew:** see Mrs Chan's approved brief; she presses "I need help (discreet)"; acknowledge, then hand over to the arrival team.
5. **Supervisor:** simulate a CX 255 delay and approve the re-plan; see real HKIA departure data. **Reset the demo trip** to start again.
6. **New passenger:** sign up, describe needs in plain words, see personal details removed, let AI suggest codes, and have staff confirm them under Checks.

## Technology

- **Google Cloud:** Cloud Run (managed serverless container serving both the SPA and `/api/*`), Cloud Build (`cloudbuild.yaml`), Artifact Registry, and `deploy-gcp.sh`.
- **AI:** Google Gemini (`gemini-2.5-flash` via `@google/genai` on Vertex AI) for fixed-menu needs-to-IATA mapping, crew brief drafting, `"How to help"` cards (<= 3 lines), and policy-grounded concierge. Built-in rules and templates take over automatically when AI is off or unavailable.
- **Cathay API adapter:** Mock-first (`backend/cathay.mjs`) with `writeServiceCodes`, `getFlightStatus`, and `getSeatMap`, tagged `source: "mock"` (falls back to mock on timeout). Built to plug into Cathay's booking, flight, and membership APIs; mock data used because no hackathon access was available.
- **Open data:** Hong Kong International Airport flight information (`DATA.GOV.HK`), fetched live (previous calendar day).
- **How to run tests:** `npm test` (runs 9 unit test suites covering `/api/health`, M1 Cathay adapter, M3 fixed menu, M4 medical routing, M6 `"How to help"` card, privacy redaction, throttling, and HKIA parsing).
- **Privacy by design:** explicit consent, redaction before AI (browser and server), needs not diagnoses, medical triggers routed to Customer Care (`clearance needed`, never added as codes), need-to-know enforced on the server, passenger sharing switches, 12 KB body cap, per-IP throttling, and error-type-only logging.

*Student concept prototype. Not a Cathay Pacific product and not endorsed by Cathay Pacific. Flights, bookings and policy text are fictional.*
