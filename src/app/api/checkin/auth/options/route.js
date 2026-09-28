import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { prisma } from "../../../../../lib/prisma";
import { appConfig } from "../../../../../lib/config";
import { isSameOriginRequest } from "../../../../../lib/session";

export async function POST(request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  const [firstName, ...lastNameParts] = name.split(" ");
  if (!firstName || !lastNameParts.length) return NextResponse.json({ error: "Enter your full name." }, { status: 400 });
  if (!appConfig.rpId || !appConfig.origin) return NextResponse.json({ error: "Passkey sign-in is not configured." }, { status: 503 });

  try {
    const employees = await prisma.employee.findMany({
      where: { firstName: { equals: firstName, mode: "insensitive" }, lastName: { equals: lastNameParts.join(" "), mode: "insensitive" } },
      include: { passkeys: { where: { revokedAt: null } } },
    });
    if (employees.length > 1) return NextResponse.json({ error: "More than one agent has this name. Contact your administrator." }, { status: 409 });
    const employee = employees[0];
    if (!employee) return NextResponse.json({ error: "This name is not on the agent roster. Ask your administrator to import you." }, { status: 404 });
    if (!employee.active) return NextResponse.json({ error: "Your enrollment is awaiting administrator approval." }, { status: 403 });
    if (!employee.passkeys.length) return NextResponse.json({ error: "Register a passkey to continue.", status: "NO_PASSKEY" }, { status: 409 });

    const options = await generateAuthenticationOptions({
      rpID: appConfig.rpId,
      userVerification: "required",
      allowCredentials: employee.passkeys.map((credential) => ({ id: credential.credentialId, transports: credential.transports })),
    });
    const challenge = await prisma.webAuthnChallenge.create({
      data: { challenge: options.challenge, purpose: "AUTHENTICATION", employeeId: employee.id, expiresAt: new Date(Date.now() + 5 * 60 * 1000) },
      select: { id: true },
    });
    return NextResponse.json({ challengeId: challenge.id, options });
  } catch (error) {
    console.error("Passkey authentication options failed:", error);
    return NextResponse.json({ error: "Unable to start sign-in. Check the database configuration." }, { status: 503 });
  }
}
