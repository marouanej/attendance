import { NextResponse } from "next/server";
import { prisma } from "../../../../../../lib/prisma";
import { getAdminSession, isSameOriginRequest } from "../../../../../../lib/session";

export async function POST(request, { params }) {
  const adminId = await getAdminSession(request);
  if (!adminId) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const { id } = await params;
  try {
    const result = await prisma.$transaction(async (transaction) => {
      const approved = await transaction.employee.updateMany({ where: { id, active: false }, data: { active: true } });
      if (approved.count !== 1) return false;
      await transaction.auditLog.create({ data: { event: "AGENT_ENROLLMENT_APPROVED", actorUserId: adminId, employeeId: id } });
      return true;
    });
    if (!result) return NextResponse.json({ error: "Pending enrollment not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Enrollment approval failed:", error);
    return NextResponse.json({ error: "Unable to approve this enrollment." }, { status: 503 });
  }
}
