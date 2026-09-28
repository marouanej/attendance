import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { getAdminSession, isSameOriginRequest } from "../../../../../lib/session";

export async function PATCH(request, { params }) {
  const adminId = await getAdminSession(request);
  if (!adminId) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  const [firstName, ...lastNameParts] = name.split(" ");
  const lastName = lastNameParts.join(" ");
  const department = typeof body.department === "string" ? body.department.trim().slice(0, 120) : "";
  if (!firstName || !lastName || name.length > 120) return NextResponse.json({ error: "Enter the agent's first and last name." }, { status: 400 });

  try {
    const updated = await prisma.$transaction(async (transaction) => {
      const normalizedName = name.toLocaleLowerCase("en");
      await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${normalizedName}, 1))`;
      const collision = await transaction.employee.findFirst({
        where: { id: { not: id }, firstName: { equals: firstName, mode: "insensitive" }, lastName: { equals: lastName, mode: "insensitive" }, active: true },
        select: { id: true },
      });
      if (collision) throw new Error("AGENT_NAME_EXISTS");
      const employee = await transaction.employee.update({
        where: { id, active: true },
        data: { firstName, lastName, department: department || null },
        select: { id: true, firstName: true, lastName: true, department: true },
      });
      await transaction.auditLog.create({
        data: { event: "AGENT_PROFILE_UPDATED", actorUserId: adminId, employeeId: id, metadata: { name, department } },
      });
      return employee;
    });
    return NextResponse.json({ id: updated.id, name: `${updated.firstName} ${updated.lastName}`, team: updated.department || "" });
  } catch (error) {
    if (error.message === "AGENT_NAME_EXISTS") return NextResponse.json({ error: "An active agent already has that name." }, { status: 409 });
    if (error.code === "P2025") return NextResponse.json({ error: "Agent not found." }, { status: 404 });
    console.error("Agent profile update failed:", error);
    return NextResponse.json({ error: "Unable to update this agent." }, { status: 503 });
  }
}

export async function DELETE(request, { params }) {
  const adminId = await getAdminSession(request);
  if (!adminId) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });

  const { id } = await params;
  try {
    const result = await prisma.$transaction(async (transaction) => {
      const removed = await transaction.employee.updateMany({
        where: { id, active: true },
        data: { active: false, removedAt: new Date(), enrollmentCodeHash: null, enrollmentCodeExpiresAt: null },
      });
      if (removed.count !== 1) return false;
      await transaction.auditLog.create({
        data: { event: "AGENT_REMOVED_FROM_ROSTER", actorUserId: adminId, employeeId: id },
      });
      return true;
    });
    if (!result) return NextResponse.json({ error: "Active agent not found." }, { status: 404 });
    return NextResponse.json({ ok: true, historyPreserved: true });
  } catch (error) {
    console.error("Agent removal failed:", error);
    return NextResponse.json({ error: "Unable to remove this agent." }, { status: 503 });
  }
}
