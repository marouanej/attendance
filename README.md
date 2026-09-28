# Presence office attendance

Secure office attendance built with Next.js App Router, plain JavaScript, PostgreSQL, Prisma, WebAuthn passkeys, GPS geofencing, and an optional trusted office-local network verifier.

## Routes

- `/` is the responsive administrator overview with attendance, CSV export, activity, and the permanent QR print panel.
- `/checkin` is the mobile-first employee entry point opened by the printed QR URL.

## Agent import and arrival flow

The administrator starts with an empty attendance list. Use **Import agents** on the dashboard and upload a CSV with a `Name` column. Optional columns are `ID`, `Department`, or `Team`.

When an agent scans the permanent QR code:

1. They enter their full name. Imported agents are looked up in PostgreSQL; an unknown name starts enrollment.
2. The phone creates a platform passkey with biometric or secure-screen-lock verification. The server verifies the WebAuthn response and stores the public key, never biometric data.
3. A new agent, or an imported agent binding their first passkey, remains inactive until an administrator verifies their identity and approves the enrollment. Enrollment does not request location.
4. On attendance check-in, the approved agent authenticates with their passkey and sends precise GPS coordinates. The server enforces the configured office geofence and accuracy limit, then records the time, location, and distance from the office in PostgreSQL.

CSV imports, pending approvals, passkeys, and server-backed attendance use PostgreSQL. The browser may still contain older demo data in local storage; it is not used to authenticate server-backed agents. Configure a reachable PostgreSQL database before using enrollment or attendance.

## Network limitation

A normal mobile browser cannot reliably read the connected Wi-Fi SSID or MAC address. This project does not fake that capability. `GPS_ONLY` validates the server-side geofence; `GPS_PLUS_LOCAL_NETWORK` additionally calls a trusted verifier on the office network using `LOCAL_NETWORK_VERIFIER_URL` and a shared secret.

## Setup

1. Install Node.js 20.19+ and PostgreSQL.
2. Copy `.env.example` to `.env` and set the database, WebAuthn origin/RP ID, office coordinates, and a long random `AUTH_SECRET`.
3. Run `npm install`, then `npm run db:generate`.
4. Apply the schema in development with `npm run db:migrate`.
5. Start the app with `npm run dev` and open `http://localhost:3000`.

## Vercel database deployment

Set `DATABASE_URL` in Vercel's project environment variables to a reachable PostgreSQL connection string before deploying. Vercel runs `vercel-build`, which applies checked-in migrations with `prisma migrate deploy`, generates Prisma Client, and builds the app. The initial migration creates all tables in an empty database. For manual deployment, run `npm run db:deploy` with the production `DATABASE_URL` configured. Never run `prisma migrate dev` against production.

WebAuthn requires HTTPS in production. `localhost` is permitted for local development. `NEXT_PUBLIC_APP_URL`, `WEBAUTHN_ORIGIN`, and `WEBAUTHN_RP_ID` must match the production HTTPS origin.

## Security model

The permanent QR contains only the configured check-in URL and never changes. A passkey proves control of an authenticator, not the real-world identity behind a typed name, so a human administrator must verify every first enrollment against official ID before approval. Biometric material never leaves the employee device. The server validates submitted GPS coordinates, calculates Haversine distance, enforces accuracy limits, applies duplicate-scan rules, and writes a server timestamp. Browser GPS can be spoofed; configure `GPS_PLUS_LOCAL_NETWORK` for an additional office-network check, or use a managed native app when stronger device location assurance is required. Attendance identity comes from the verified passkey session, never from a client-provided employee ID.

The Prisma schema includes employees, multiple revocable passkeys, attendance events, office settings, and audit logs. Keep location retention limited to the attendance purpose and document the retention policy for employees.

## Production checklist

- Put the app behind HTTPS and secure, HTTP-only session cookies.
- Remove expired WebAuthn challenge records periodically.
- Add rate limiting to passkey, registration, and attendance endpoints.
- Protect admin mutations with server-side role checks and audit them.
- Configure `AUTH_SECRET`, admin credentials, and a production PostgreSQL URL as deployment secrets; rotate any values that have been exposed.
- Run `npm run db:validate` and `npm run build` in CI.
- Deploy the local verifier inside the office network; do not expose it publicly.
- Configure backups, log redaction, and a location-data retention schedule.

## Validation

```bash
npm run db:validate
npm run build
```
