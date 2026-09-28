import { NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { prisma } from "../../../../../lib/prisma";
import { appConfig } from "../../../../../lib/config";
import { isSameOriginRequest } from "../../../../../lib/session";

export async function POST(request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  if (typeof body.challengeId !== "string" || !body.response) {
    return NextResponse.json({ error: "Enrollment details are incomplete." }, { status: 400 });
  }

  try {
    const challenge = await prisma.webAuthnChallenge.findUnique({ where: { id: body.challengeId } });
    if (!challenge || challenge.purpose !== "CREDENTIAL_ENROLLMENT" || !challenge.employeeId || !challenge.enrollmentCodeHash || challenge.consumedAt || challenge.expiresAt <= new Date()) {
      return NextResponse.json({ error: "Enrollment expired. Start again." }, { status: 400 });
    }

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

    const { credential } = verification.registrationInfo;
    const employee = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${challenge.employeeId}, 0))`;
      const imported = await transaction.employee.findUnique({
        where: { id: challenge.employeeId },
        include: { passkeys: { where: { revokedAt: null }, select: { id: true } } },
      });
      if (!imported?.active || imported.passkeys.length || imported.enrollmentCodeHash !== challenge.enrollmentCodeHash || !imported.enrollmentCodeExpiresAt || imported.enrollmentCodeExpiresAt <= new Date()) {
        throw new Error("ENROLLMENT_CODE_INVALID");
      }

      const claimed = await transaction.webAuthnChallenge.updateMany({
        where: { id: challenge.id, purpose: challenge.purpose, consumedAt: null, expiresAt: { gt: new Date() }, enrollmentCodeHash: challenge.enrollmentCodeHash },
        data: { consumedAt: new Date() },
      });
      if (claimed.count !== 1) throw new Error("ENROLLMENT_EXPIRED");

      const passkeyData = {
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        transports: credential.transports || [],
      };

      const consumedCode = await transaction.employee.updateMany({
        where: { id: imported.id, enrollmentCodeHash: challenge.enrollmentCodeHash, enrollmentCodeExpiresAt: { gt: new Date() }, active: true },
        data: { enrollmentCodeHash: null, enrollmentCodeExpiresAt: null, active: false },
      });
      if (consumedCode.count !== 1) throw new Error("ENROLLMENT_CODE_INVALID");
      await transaction.passkeyCredential.create({ data: { ...passkeyData, employeeId: imported.id } });
      await transaction.auditLog.create({
        data: {
          event: "AGENT_CREDENTIAL_PENDING",
          employeeId: imported.id,
          metadata: { fullName: `${imported.firstName} ${imported.lastName}` },
        },
      });
      return imported;
    });

    return NextResponse.json({ status: "PENDING_APPROVAL", employeeId: employee.id, name: `${employee.firstName} ${employee.lastName}` });
  } catch (error) {
    if (error.message === "ENROLLMENT_EXPIRED") return NextResponse.json({ error: "Enrollment expired. Start again." }, { status: 400 });
    if (error.message === "ENROLLMENT_CODE_INVALID") return NextResponse.json({ error: "This enrollment code is invalid, expired, or already used." }, { status: 409 });
    console.error("Passkey enrollment verification failed:", error);
    return NextResponse.json({ error: "Unable to complete enrollment. Check server configuration." }, { status: 503 });
  }
}
