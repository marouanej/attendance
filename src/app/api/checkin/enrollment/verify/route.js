import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { prisma } from "../../../../../lib/prisma";
import { appConfig, getOfficeConfig } from "../../../../../lib/config";
import { validateCoordinates } from "../../../../../lib/geofence";
import { isSameOriginRequest } from "../../../../../lib/session";
import { verifyOfficeNetwork } from "../../../../../lib/network-verification";

export async function POST(request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  if (typeof body.challengeId !== "string" || !body.response) {
    return NextResponse.json({ error: "Enrollment details are incomplete." }, { status: 400 });
  }

  try {
    const challenge = await prisma.webAuthnChallenge.findUnique({ where: { id: body.challengeId } });
    if (!challenge || !["ENROLLMENT", "CREDENTIAL_ENROLLMENT"].includes(challenge.purpose) || challenge.consumedAt || challenge.expiresAt <= new Date()) {
      return NextResponse.json({ error: "Enrollment expired. Start again." }, { status: 400 });
    }

    const office = getOfficeConfig();
    const location = validateCoordinates(body.location || {}, {
      latitude: office.officeLatitude,
      longitude: office.officeLongitude,
      radius: office.geofenceRadius,
      maxAccuracy: office.maxGpsAccuracy,
    });
    if (!location.ok) {
      return NextResponse.json({ error: location.reason === "OUTSIDE_GEOFENCE" ? "You must be at the office to enroll." : "Precise location is required to enroll." }, { status: 403 });
    }
    const network = await verifyOfficeNetwork({
      request,
      mode: office.networkMode,
      verifierUrl: process.env.LOCAL_NETWORK_VERIFIER_URL,
      verifierSecret: process.env.LOCAL_NETWORK_VERIFIER_SECRET,
    });
    if (network.required && !network.verified) return NextResponse.json({ error: "Office network verification failed." }, { status: 403 });

    const verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: appConfig.origin,
      expectedRPID: appConfig.rpId,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo?.userVerified) {
      return NextResponse.json({ error: "Passkey verification failed." }, { status: 400 });
    }

    const { firstName, lastName } = splitName(challenge.employeeName);
    const fullName = `${firstName} ${lastName}`;
    const { credential } = verification.registrationInfo;
    const employee = await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.webAuthnChallenge.updateMany({
        where: { id: challenge.id, purpose: challenge.purpose, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (claimed.count !== 1) throw new Error("ENROLLMENT_EXPIRED");

      const passkeyData = {
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        transports: credential.transports || [],
      };

      if (challenge.purpose === "CREDENTIAL_ENROLLMENT") {
        await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${challenge.employeeId}, 0))`;
        const imported = await transaction.employee.findUnique({
          where: { id: challenge.employeeId },
          include: { passkeys: { where: { revokedAt: null }, select: { id: true } } },
        });
        if (!imported?.active || imported.passkeys.length) throw new Error("CREDENTIAL_ENROLLMENT_INVALID");
        await transaction.passkeyCredential.create({ data: { ...passkeyData, employeeId: imported.id } });
        await transaction.employee.update({ where: { id: imported.id }, data: { active: false } });
        await transaction.auditLog.create({
          data: {
            event: "AGENT_CREDENTIAL_PENDING",
            employeeId: imported.id,
            metadata: { fullName, locationVerified: true, networkVerified: network.verified, distanceFromOffice: location.distance, gpsAccuracy: location.accuracy },
          },
        });
        return imported;
      }

      await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${fullName.toLowerCase()}, 1))`;
      const existing = await transaction.employee.findFirst({
        where: { firstName: { equals: firstName, mode: "insensitive" }, lastName: { equals: lastName, mode: "insensitive" } },
        select: { id: true },
      });
      if (existing) throw new Error("AGENT_ALREADY_EXISTS");

      const userId = randomUUID();
      const internalEmail = `agent-${userId}@enrollment.invalid`;
      const created = await transaction.user.create({
        data: {
          email: internalEmail,
          role: "EMPLOYEE",
          employee: {
            create: {
              employeeNumber: `PENDING-${userId}`,
              firstName,
              lastName,
              email: internalEmail,
              active: false,
              passkeys: { create: passkeyData },
            },
          },
        },
        select: { employee: { select: { id: true } } },
      });
      await transaction.auditLog.create({
        data: {
          event: "AGENT_ENROLLMENT_PENDING",
          employeeId: created.employee.id,
          metadata: { fullName, locationVerified: true, networkVerified: network.verified, distanceFromOffice: location.distance, gpsAccuracy: location.accuracy },
        },
      });
      return created.employee;
    });

    return NextResponse.json({ status: "PENDING_APPROVAL", employeeId: employee.id, name: fullName });
  } catch (error) {
    if (error.message === "ENROLLMENT_EXPIRED") return NextResponse.json({ error: "Enrollment expired. Start again." }, { status: 400 });
    if (error.message === "AGENT_ALREADY_EXISTS") return NextResponse.json({ error: "An agent with that name has already enrolled." }, { status: 409 });
    if (error.message === "CREDENTIAL_ENROLLMENT_INVALID") return NextResponse.json({ error: "This account can no longer bind a passkey. Start again." }, { status: 409 });
    console.error("Passkey enrollment verification failed:", error);
    return NextResponse.json({ error: "Unable to complete enrollment. Check server configuration." }, { status: 503 });
  }
}

function splitName(value) {
  const [firstName, ...lastParts] = value.trim().split(/\s+/);
  return { firstName, lastName: lastParts.join(" ") };
}
