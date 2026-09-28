import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { prisma } from "../../../../../lib/prisma";
import { appConfig } from "../../../../../lib/config";
import { isSameOriginRequest } from "../../../../../lib/session";

export async function POST(request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  const parts = name.split(" ");
  if (parts.length < 2 || name.length > 120) {
    return NextResponse.json({ error: "Enter your first and last name." }, { status: 400 });
  }
  if (!appConfig.rpId || !appConfig.origin) {
    return NextResponse.json({ error: "Passkey sign-in is not configured." }, { status: 503 });
  }

  try {
    const employees = await prisma.employee.findMany({
      where: { firstName: { equals: parts[0], mode: "insensitive" }, lastName: { equals: parts.slice(1).join(" "), mode: "insensitive" } },
      include: { passkeys: { where: { revokedAt: null }, select: { id: true } } },
    });
    if (employees.length > 1) return NextResponse.json({ error: "More than one agent has this name. Contact your administrator." }, { status: 409 });
    const employee = employees[0];
    if (employee) {
      if (!employee.active) return NextResponse.json({ error: "Your enrollment is awaiting administrator approval.", status: "PENDING" }, { status: 409 });
      if (employee.passkeys.length) return NextResponse.json({ error: "This agent is already registered. Use the sign-in option.", status: "REGISTERED" }, { status: 409 });

      const options = await generateRegistrationOptions({
        rpName: appConfig.rpName,
        rpID: appConfig.rpId,
        userName: employee.email,
        userDisplayName: name,
        userID: new TextEncoder().encode(employee.id),
        attestationType: "none",
        authenticatorSelection: { residentKey: "required", userVerification: "required", authenticatorAttachment: "platform" },
      });
      const challenge = await prisma.webAuthnChallenge.create({
        data: { challenge: options.challenge, purpose: "CREDENTIAL_ENROLLMENT", employeeId: employee.id, employeeName: name, expiresAt: new Date(Date.now() + 5 * 60 * 1000) },
        select: { id: true },
      });
      return NextResponse.json({ challengeId: challenge.id, options });
    }

    const userId = randomUUID();
    const options = await generateRegistrationOptions({
      rpName: appConfig.rpName,
      rpID: appConfig.rpId,
      userName: `${userId}@enrollment.invalid`,
      userDisplayName: name,
      userID: new TextEncoder().encode(userId),
      attestationType: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "required", authenticatorAttachment: "platform" },
    });
    const challenge = await prisma.webAuthnChallenge.create({
      data: { challenge: options.challenge, purpose: "ENROLLMENT", employeeName: name, expiresAt: new Date(Date.now() + 5 * 60 * 1000) },
      select: { id: true },
    });
    return NextResponse.json({ challengeId: challenge.id, options });
  } catch (error) {
    console.error("Passkey enrollment options failed:", error);
    return NextResponse.json({ error: "Unable to start enrollment. Check the database configuration." }, { status: 503 });
  }
}
