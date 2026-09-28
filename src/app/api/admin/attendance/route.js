import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getAdminSession, isSameOriginRequest } from "../../../../lib/session";
import { getCasablancaDate, getCasablancaDay } from "../../../../lib/casablanca-time";

export async function GET(request) {
  if (!await getAdminSession(request)) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  try {
    const now = new Date();
    const { day, start, end } = getCasablancaDay(now);
    const [employees, events, todayStatuses, activeLeaveStatuses] = await Promise.all([
      prisma.employee.findMany({ where: { active: true }, include: { passkeys: { where: { revokedAt: null }, select: { id: true } } } }),
      prisma.attendance.findMany({
        where: { timestamp: { gte: start, lt: end }, verificationStatus: "VERIFIED" },
        include: { employee: { select: { firstName: true, lastName: true, department: true } } },
        orderBy: { timestamp: "desc" },
      }),
      prisma.employeeDayStatus.findMany({ where: { day } }),
      prisma.employeeDayStatus.findMany({
        where: { day: { lt: day }, status: { in: ["PERMISSION", "RECUPERATION"] }, validUntil: { gt: now } },
        orderBy: { day: "desc" },
      }),
    ]);
    const checkIns = new Map(events.filter((event) => event.eventType === "CHECK_IN").map((event) => [event.employeeId, event]));
    const statusByEmployee = new Map(todayStatuses.map((status) => [status.employeeId, status]));
    const leaveByEmployee = new Map();
    for (const status of activeLeaveStatuses) {
      if (!leaveByEmployee.has(status.employeeId)) leaveByEmployee.set(status.employeeId, status);
    }
    return NextResponse.json({
      day,
      agents: employees.map((employee) => {
        const checkIn = checkIns.get(employee.id);
        const currentStatus = statusByEmployee.get(employee.id);
        const activeLeave = leaveByEmployee.get(employee.id);
        let dayStatus = currentStatus?.status ?? activeLeave?.status ?? "NOT_ARRIVED";
        let validUntil = currentStatus?.validUntil ?? activeLeave?.validUntil ?? null;
        if (checkIn) dayStatus = "PRESENT";
        else if (currentStatus?.status && currentStatus.status !== "ABSENT" && currentStatus.validUntil && currentStatus.validUntil <= now) dayStatus = "ABSENT";
        return {
          id: employee.id,
          name: `${employee.firstName} ${employee.lastName}`,
          team: employee.department || "",
          canIssueEnrollmentCode: employee.passkeys.length === 0,
          dayStatus,
          validUntil,
          validThrough: ["PERMISSION", "RECUPERATION"].includes(dayStatus) && validUntil > now ? getCasablancaDate(validUntil) : null,
          durationHours: currentStatus?.status === dayStatus ? currentStatus.durationHours : activeLeave?.status === dayStatus ? activeLeave.durationHours : null,
        };
      }),
      attendance: events.map((event) => ({
        id: event.id,
        agentId: event.employeeId,
        agentName: `${event.employee.firstName} ${event.employee.lastName}`,
        timestamp: event.timestamp,
        accuracy: Number(event.gpsAccuracy),
        distance: Number(event.distanceFromOffice),
      })),
    });
  } catch (error) {
    console.error("Attendance dashboard lookup failed:", error);
    return NextResponse.json({ error: "Unable to load server attendance." }, { status: 503 });
  }
}

export async function DELETE(request) {
  const adminId = await getAdminSession(request);
  if (!adminId) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const { day, start, end } = getCasablancaDay(new Date());
  try {
    if (typeof body.eventId === "string" && body.eventId) {
      const deleted = await prisma.$transaction(async (transaction) => {
        const event = await transaction.attendance.findUnique({ where: { id: body.eventId }, select: { id: true, employeeId: true, timestamp: true } });
        if (!event || event.timestamp < start || event.timestamp >= end) return false;
        await transaction.attendance.delete({ where: { id: event.id } });
        await transaction.auditLog.create({
          data: { event: "ATTENDANCE_EVENT_DELETED", actorUserId: adminId, employeeId: event.employeeId, metadata: { attendanceId: event.id, day } },
        });
        return true;
      });
      if (!deleted) return NextResponse.json({ error: "Today's attendance record was not found." }, { status: 404 });
      return NextResponse.json({ deletedCount: 1 });
    }

    const deletedCount = await prisma.$transaction(async (transaction) => {
      const result = await transaction.attendance.deleteMany({ where: { timestamp: { gte: start, lt: end } } });
      await transaction.auditLog.create({
        data: { event: "TODAYS_ATTENDANCE_CLEARED", actorUserId: adminId, metadata: { day, deletedCount: result.count } },
      });
      return result.count;
    });
    return NextResponse.json({ deletedCount, day });
  } catch (error) {
    console.error("Manual attendance deletion failed:", error);
    return NextResponse.json({ error: "Unable to delete attendance data." }, { status: 503 });
  }
}
