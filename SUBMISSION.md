# E394 – Nevada · Smooth Journey

**Team:** Chris, Ruthvik, Ingram, Abi

## Links

- **Live app (Google Cloud Run):** https://smooth-journey-903081649355.asia-east2.run.app
- **Follow Mrs Chan live (carer view):** https://smooth-journey-903081649355.asia-east2.run.app/?as=carer&p=chan
- **Scripted walkthrough used in our video:** https://smooth-journey-903081649355.asia-east2.run.app/demo.html
- **Codebase:** https://github.com/chrixtang/smooth-journey

## Try it (no sign-in)

The app opens straight into the demo. Switch view with the dropdown at the top: **Passenger**, **Carer** or **Ground staff**. The ••• menu switches traveller and resets the demo.

1. **Passenger (Mrs Chan):** Trip → Your needs → Match → Booking → Add to booking → Crew brief → Approve. On Journey, tap "I need help".
2. **Ground staff:** acknowledge the help request, confirm the AI-suggested codes, then confirm each handover. The Departures tab shows real HKIA open data.
3. **Carer (Mei):** each handover appears live on the carer's phone.

Direct links: `/?as=carer&p=chan` (follow Mrs Chan live) · `/?as=passenger&p=leo` (try the passenger flow on a separate trip).

## Technology

- **Google Cloud:** one Cloud Run service in `asia-east2` (Node.js 24 container serving the app and `/api/*`), pinned to one always-on instance because the demo journey is held in memory. Deployed with `deploy-gcp.sh` or Cloud Build (`cloudbuild.yaml`).
- **AI:** Google Gemini (`gemini-2.5-flash` via `@google/genai` on Vertex AI) for fixed-menu needs-to-IATA mapping, crew brief drafting, `"How to help"` cards (<= 3 lines), and policy-grounded concierge. Built-in rules and templates take over automatically when AI is off or unavailable.
- **Cathay API adapter:** Mock-first (`backend/cathay.mjs`) with `writeServiceCodes`, `getFlightStatus`, and `getSeatMap`, tagged `source: "mock"` (falls back to mock on timeout). Built to plug into Cathay's booking, flight, and membership APIs; mock data used because no hackathon access was available.
- **Open data:** Hong Kong International Airport flight information (`DATA.GOV.HK`), fetched live (previous calendar day).
- **How to run tests:** `npm test` (10 backend tests: `/api/health`, Cathay adapter, fixed menu, medical routing, `"How to help"` card, AI guardrails and throttling, HKIA parsing, and the shared three-view journey).
- **Privacy by design:** redaction on the server before AI, needs not diagnoses, medical triggers routed to Customer Care (`clearance needed`, never added as codes), need-to-know enforced on the server, passenger sharing switches, 12 KB body cap, per-IP throttling, and error-type-only logging.

*Student concept prototype. Not a Cathay Pacific product and not endorsed by Cathay Pacific. Flights, bookings and policy text are fictional.*
