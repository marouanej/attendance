import { NextResponse } from "next/server";
import { prisma } from "../../../../../../lib/prisma";
import { getAdminSession, isSameOriginRequest } from "../../../../../../lib/session";
import { getCasablancaDay } from "../../../../../../lib/casablanca-time";

const leaveDurations = new Set([24, 72, 96]);
const allowedStatuses = new Set(["PERMISSION", "RECUPERATION", "ABSENT"]);

export async function POST(request, { params }) {
  const adminId = await getAdminSession(request);
  if (!adminId) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (!allowedStatuses.has(body.status)) return NextResponse.json({ error: "Choose permission, recuperation, or absent." }, { status: 400 });
  if (["PERMISSION", "RECUPERATION"].includes(body.status) && !leaveDurations.has(Number(body.durationHours))) {
    return NextResponse.json({ error: "Choose a leave duration of 24, 72, or 96 hours." }, { status: 400 });
  }

  try {
    const now = new Date();
    const { day, start, end } = getCasablancaDay(now);
    const employee = await prisma.employee.findFirst({ where: { id, active: true }, select: { id: true } });
    if (!employee) return NextResponse.json({ error: "Active agent not found." }, { status: 404 });

    const validUntil = ["PERMISSION", "RECUPERATION"].includes(body.status)
      ? new Date(now.getTime() + Number(body.durationHours) * 60 * 60 * 1000)
      : null;
    const durationHours = validUntil ? Number(body.durationHours) : null;
    const record = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`${id}:${day}`}, 2))`;
      const arrival = await transaction.attendance.findFirst({
        where: { employeeId: id, eventType: "CHECK_IN", verificationStatus: "VERIFIED", timestamp: { gte: start, lt: end } },
        select: { id: true },
      });
      if (arrival) throw new Error("EMPLOYEE_ALREADY_ARRIVED");
      await transaction.employeeDayStatus.updateMany({
        where: { employeeId: id, day: { lt: day }, status: { in: ["PERMISSION", "RECUPERATION"] }, validUntil: { gt: now } },
        data: { validUntil: now },
      });
      const status = await transaction.employeeDayStatus.upsert({
        where: { employeeId_day: { employeeId: id, day } },
        create: { employeeId: id, day, status: body.status, durationHours, validUntil, setBy: adminId },
        update: { status: body.status, durationHours, validUntil, setBy: adminId },
        select: { employeeId: true, day: true, status: true, durationHours: true, validUntil: true },
      });
      await transaction.auditLog.create({
        data: {
          event: "EMPLOYEE_DAY_STATUS_SET",
          actorUserId: adminId,
          employeeId: id,
          metadata: { status: body.status, durationHours, day },
        },
      });
      return status;
    });
    return NextResponse.json(record);
  } catch (error) {
    if (error.message === "EMPLOYEE_ALREADY_ARRIVED") return NextResponse.json({ error: "This agent has already checked in today." }, { status: 409 });
    console.error("Employee status update failed:", error);
    return NextResponse.json({ error: "Unable to save this employee status." }, { status: 503 });
  }
}
