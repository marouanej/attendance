import { NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { prisma } from "../../../../../lib/prisma";
import { appConfig } from "../../../../../lib/config";
import { createSessionToken, isSameOriginRequest, setSessionCookie } from "../../../../../lib/session";

export async function POST(request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.challengeId !== "string" || typeof body.response?.id !== "string") {
    return NextResponse.json({ error: "Passkey response is incomplete." }, { status: 400 });
  }

  try {
    const challenge = await prisma.webAuthnChallenge.findUnique({ where: { id: body.challengeId } });
    if (!challenge || challenge.purpose !== "AUTHENTICATION" || !challenge.employeeId || challenge.consumedAt || challenge.expiresAt <= new Date()) {
      return NextResponse.json({ error: "Sign-in expired. Try again." }, { status: 400 });
    }
    const credential = await prisma.passkeyCredential.findUnique({
      where: { credentialId: body.response.id },
      include: { employee: { select: { id: true, active: true } } },
    });
    if (!credential || credential.employeeId !== challenge.employeeId || !credential.employee.active || credential.revokedAt) {
      return NextResponse.json({ error: "This passkey is not registered to an active agent." }, { status: 401 });
    }

    const verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: appConfig.origin,
      expectedRPID: appConfig.rpId,
      credential: {
        id: credential.credentialId,
        publicKey: new Uint8Array(credential.publicKey),
        counter: Number(credential.counter),
        transports: credential.transports,
      },
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.authenticationInfo.userVerified) {
      return NextResponse.json({ error: "Passkey verification failed." }, { status: 401 });
    }

    await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.webAuthnChallenge.updateMany({
        where: { id: challenge.id, purpose: "AUTHENTICATION", consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (claimed.count !== 1) throw new Error("AUTHENTICATION_EXPIRED");
      await transaction.passkeyCredential.update({
        where: { id: credential.id },
        data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() },
      });
    });

    const token = await createSessionToken(credential.employeeId, "EMPLOYEE", "10m");
    const response = NextResponse.json({ ok: true });
    setSessionCookie(response, "attendance_employee", token, 10 * 60);
    return response;
  } catch (error) {
    if (error.message === "AUTHENTICATION_EXPIRED") return NextResponse.json({ error: "Sign-in expired. Try again." }, { status: 400 });
    console.error("Passkey authentication failed:", error);
    return NextResponse.json({ error: "Unable to verify this passkey." }, { status: 401 });
  }
}
