import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "../../../../../../lib/prisma";
import { getAdminSession, isSameOriginRequest } from "../../../../../../lib/session";

export async function POST(request, { params }) {
  const adminId = await getAdminSession(request);
  if (!adminId) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });

  const { id } = await params;
  const enrollmentCode = randomBytes(12).toString("hex").toUpperCase();
  const enrollmentCodeHash = createHash("sha256").update(enrollmentCode).digest("hex");
  const enrollmentCodeExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  try {
    const result = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${id}, 3))`;
      const employee = await transaction.employee.findUnique({
        where: { id },
        include: { passkeys: { where: { revokedAt: null }, select: { id: true } } },
      });
      if (!employee?.active) throw new Error("EMPLOYEE_NOT_ACTIVE");
      if (employee.passkeys.length) throw new Error("PASSKEY_ALREADY_REGISTERED");
      await transaction.employee.update({
        where: { id },
        data: { enrollmentCodeHash, enrollmentCodeExpiresAt },
      });
      await transaction.auditLog.create({
        data: { event: "EMPLOYEE_ENROLLMENT_CODE_ISSUED", actorUserId: adminId, employeeId: id },
      });
      return { id: employee.id, name: `${employee.firstName} ${employee.lastName}`, expiresAt: enrollmentCodeExpiresAt };
    });
    return NextResponse.json({ ...result, code: enrollmentCode });
  } catch (error) {
    if (error.message === "EMPLOYEE_NOT_ACTIVE") return NextResponse.json({ error: "Active roster agent not found." }, { status: 404 });
    if (error.message === "PASSKEY_ALREADY_REGISTERED") return NextResponse.json({ error: "This agent already has a passkey." }, { status: 409 });
    console.error("Enrollment code issuance failed:", error);
    return NextResponse.json({ error: "Unable to issue the enrollment code." }, { status: 503 });
  }
}
