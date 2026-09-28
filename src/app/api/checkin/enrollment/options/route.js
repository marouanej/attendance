import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { prisma } from "../../../../../lib/prisma";
import { appConfig } from "../../../../../lib/config";
import { isSameOriginRequest } from "../../../../../lib/session";

export async function POST(request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "").toUpperCase() : "";
  const parts = name.split(" ");
  if (parts.length < 2 || name.length > 120) {
    return NextResponse.json({ error: "Enter your first and last name." }, { status: 400 });
  }
  if (!appConfig.rpId || !appConfig.origin) {
    return NextResponse.json({ error: "Passkey sign-in is not configured." }, { status: 503 });
  }
  if (!/^[A-F0-9]{24}$/.test(code)) return NextResponse.json({ error: "Enter the one-time enrollment code from your administrator." }, { status: 400 });

  try {
    const employees = await prisma.employee.findMany({
      where: { firstName: { equals: parts[0], mode: "insensitive" }, lastName: { equals: parts.slice(1).join(" "), mode: "insensitive" } },
      include: { passkeys: { where: { revokedAt: null }, select: { id: true } } },
    });
    if (employees.length > 1) return NextResponse.json({ error: "More than one agent has this name. Contact your administrator." }, { status: 409 });
    const employee = employees[0];
    if (!employee) return NextResponse.json({ error: "This name is not on the agent roster. Ask your administrator to import you." }, { status: 404 });
    if (!employee.active) return NextResponse.json({ error: "Your enrollment is awaiting administrator approval.", status: "PENDING" }, { status: 409 });
    if (employee.passkeys.length) return NextResponse.json({ error: "This agent already has a passkey. Sign in instead." }, { status: 409 });
    const suppliedHash = createHash("sha256").update(code).digest();
    const storedHash = employee.enrollmentCodeHash ? Buffer.from(employee.enrollmentCodeHash, "hex") : Buffer.alloc(suppliedHash.length);
    if (!employee.enrollmentCodeHash || storedHash.length !== suppliedHash.length || !timingSafeEqual(suppliedHash, storedHash) || !employee.enrollmentCodeExpiresAt || employee.enrollmentCodeExpiresAt <= new Date()) {
      return NextResponse.json({ error: "The enrollment code is invalid or expired. Ask your administrator for a new one." }, { status: 403 });
    }

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
      data: { challenge: options.challenge, purpose: "CREDENTIAL_ENROLLMENT", employeeId: employee.id, employeeName: name, enrollmentCodeHash: employee.enrollmentCodeHash, expiresAt: new Date(Date.now() + 5 * 60 * 1000) },
      select: { id: true },
    });
    return NextResponse.json({ challengeId: challenge.id, options });
  } catch (error) {
    console.error("Passkey enrollment options failed:", error);
    return NextResponse.json({ error: "Unable to start enrollment. Check the database configuration." }, { status: 503 });
  }
}
