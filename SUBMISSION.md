# E394 – Nevada · Smooth Journey

**Team:** Chris, Ruthvik, Ingram, Abi

## Links

- **Live app (Google Cloud Run):** https://smooth-journey-903081649355.asia-east2.run.app
- **Interactive demo:** https://smooth-journey-903081649355.asia-east2.run.app/demo.html
- **Codebase:** https://github.com/chrixtang/smooth-journey
- **Fallback video:** https://REPLACE-WITH-YOUR-FALLBACK-VIDEO-LINK

## Try it (no sign-in)

The app opens straight into the demo. Switch view with the dropdown at the top: **Passenger**, **Carer** or **Ground staff**. The ••• menu switches traveller and resets the demo.

1. **Passenger (Mrs Chan):** Trip → Your needs → Match → Booking → Add to booking → Crew brief → Approve. On Journey, tap "I need help".
2. **Ground staff:** acknowledge the help request, confirm the AI-suggested codes, then confirm each handover. The Flights tab shows real HKIA open data.
3. **Carer (Mei):** each handover appears live on the carer's phone.

Direct links: `/?as=carer&p=chan` (follow Mrs Chan live) · `/?as=passenger&p=leo` (try the passenger flow on a separate trip).

## Technology

- **Google Cloud:** Cloud Run (managed serverless container serving both the SPA and `/api/*`), Cloud Build (`cloudbuild.yaml`), Artifact Registry, and `deploy-gcp.sh`.
- **AI:** Google Gemini (`gemini-2.5-flash` via `@google/genai` on Vertex AI) for fixed-menu needs-to-IATA mapping, crew brief drafting, `"How to help"` cards (<= 3 lines), and policy-grounded concierge. Built-in rules and templates take over automatically when AI is off or unavailable.
- **Cathay API adapter:** Mock-first (`backend/cathay.mjs`) with `writeServiceCodes`, `getFlightStatus`, and `getSeatMap`, tagged `source: "mock"` (falls back to mock on timeout). Built to plug into Cathay's booking, flight, and membership APIs; mock data used because no hackathon access was available.
- **Open data:** Hong Kong International Airport flight information (`DATA.GOV.HK`), fetched live (previous calendar day).
- **How to run tests:** `npm test` (runs 9 unit test suites covering `/api/health`, M1 Cathay adapter, M3 fixed menu, M4 medical routing, M6 `"How to help"` card, privacy redaction, throttling, and HKIA parsing).
- **Privacy by design:** explicit consent, redaction before AI (browser and server), needs not diagnoses, medical triggers routed to Customer Care (`clearance needed`, never added as codes), need-to-know enforced on the server, passenger sharing switches, 12 KB body cap, per-IP throttling, and error-type-only logging.

*Student concept prototype. Not a Cathay Pacific product and not endorsed by Cathay Pacific. Flights, bookings and policy text are fictional.*
