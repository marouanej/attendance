# Presence office attendance

Secure office attendance built with Next.js App Router, plain JavaScript, PostgreSQL, Prisma, WebAuthn passkeys, GPS geofencing, and an optional trusted office-local network verifier.

## Routes

- `/` is the responsive administrator overview with attendance, CSV export, activity, and the permanent QR print panel.
- `/checkin` is the mobile-first employee entry point opened by the printed QR URL.

## Agent import and arrival flow

The administrator starts with an empty attendance list. Use **Import agents** on the dashboard and upload a CSV with a `Name` column. Optional columns are `ID`, `Department`, or `Team`.

When an agent scans the permanent QR code:

1. They enter the name that was imported by the administrator.
2. On the first scan, the phone registers a platform passkey using Face ID, fingerprint, or the device PIN. Later scans verify that same passkey.
3. The page requests precise GPS coordinates and accuracy.
4. The arrival time, GPS accuracy, coordinates, and calculated distance are shown to the agent and added to the admin attendance view.

The browser demo stores imported agents and events in local browser storage so the complete flow can be tried immediately. For multiple phones and production deployment, connect the existing Prisma models and API routes to PostgreSQL; browser local storage must not be used as the production source of truth.

## Network limitation

A normal mobile browser cannot reliably read the connected Wi-Fi SSID or MAC address. This project does not fake that capability. `GPS_ONLY` validates the server-side geofence; `GPS_PLUS_LOCAL_NETWORK` additionally calls a trusted verifier on the office network using `LOCAL_NETWORK_VERIFIER_URL` and a shared secret.

## Setup

1. Install Node.js 20.19+ and PostgreSQL.
2. Copy `.env.example` to `.env` and set the database, WebAuthn origin/RP ID, office coordinates, and a long random `AUTH_SECRET`.
3. Run `npm install`, then `npm run db:generate`.
4. Apply the schema in development with `npm run db:migrate`.
5. Start the app with `npm run dev` and open `http://localhost:3000`.

WebAuthn requires HTTPS in production. `localhost` is permitted for local development. `NEXT_PUBLIC_APP_URL`, `WEBAUTHN_ORIGIN`, and `WEBAUTHN_RP_ID` must match the production HTTPS origin.

## Security model

The permanent QR contains only the configured check-in URL and never changes. Identity is provided by a registered passkey; biometric material never leaves the employee device. The server must validate raw GPS coordinates, calculate Haversine distance, enforce accuracy limits, apply duplicate-scan rules, and write a server timestamp. Identity must come from the authenticated passkey/session, never from a client-provided employee ID.

The Prisma schema includes employees, multiple revocable passkeys, attendance events, office settings, and audit logs. Keep location retention limited to the attendance purpose and document the retention policy for employees.

## Production checklist

- Put the app behind HTTPS and secure, HTTP-only session cookies.
- Persist WebAuthn challenges server-side with one-time expiry.
- Add rate limiting to passkey, registration, and attendance endpoints.
- Protect admin mutations with server-side role checks and audit them.
- Run `npm run db:validate` and `npm run build` in CI.
- Deploy the local verifier inside the office network; do not expose it publicly.
- Configure backups, log redaction, and a location-data retention schedule.

## Validation

```bash
npm run db:validate
npm run build
```
