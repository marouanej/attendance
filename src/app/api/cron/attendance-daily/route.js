import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getCasablancaDay, getCasablancaHour } from "../../../../lib/casablanca-time";

const AUTOMATION_ACTOR = "SCHEDULED_ATTENDANCE_JOB";

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const now = new Date();
  const { day, start, end } = getCasablancaDay(now);
  const hour = getCasablancaHour(now);
  if (hour >= 10 && hour < 18) return markNonArrivalsAbsent(day, start, end, now);
  if (hour >= 18) return clearArrivals(day, start, end);
  return NextResponse.json({ status: "skipped", day, hour, timeZone: "Africa/Casablanca" });
}

async function markNonArrivalsAbsent(day, start, end, now) {
  try {
    const employees = await prisma.employee.findMany({ where: { active: true }, select: { id: true } });
    let markedAbsent = 0;
    let carriedLeave = 0;

    for (const employee of employees) {
      const result = await prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`${employee.id}:${day}`}, 2))`;
        const todayStatus = await transaction.employeeDayStatus.findUnique({ where: { employeeId_day: { employeeId: employee.id, day } } });
        if (todayStatus?.status === "ABSENT") return "UNCHANGED";
        if (todayStatus && ["PERMISSION", "RECUPERATION"].includes(todayStatus.status) && todayStatus.validUntil > now) return "LEAVE";

        const arrival = await transaction.attendance.findFirst({
          where: { employeeId: employee.id, eventType: "CHECK_IN", verificationStatus: "VERIFIED", timestamp: { gte: start, lt: end } },
          select: { id: true },
        });
        if (arrival) return "ARRIVED";

        const activeLeave = todayStatus && ["PERMISSION", "RECUPERATION"].includes(todayStatus.status) && todayStatus.validUntil <= now
          ? null
          : await transaction.employeeDayStatus.findFirst({
            where: { employeeId: employee.id, day: { lt: day }, status: { in: ["PERMISSION", "RECUPERATION"] }, validUntil: { gt: now } },
            orderBy: { day: "desc" },
          });
        const status = activeLeave?.status ?? "ABSENT";
        await transaction.employeeDayStatus.upsert({
          where: { employeeId_day: { employeeId: employee.id, day } },
          create: { employeeId: employee.id, day, status, durationHours: activeLeave?.durationHours ?? null, validUntil: activeLeave?.validUntil ?? null, setBy: AUTOMATION_ACTOR },
          update: { status, durationHours: activeLeave?.durationHours ?? null, validUntil: activeLeave?.validUntil ?? null, setBy: AUTOMATION_ACTOR },
        });
        return status === "ABSENT" ? "ABSENT" : "LEAVE";
      });
      if (result === "ABSENT") markedAbsent += 1;
      if (result === "LEAVE") carriedLeave += 1;
    }

    return NextResponse.json({ status: "processed", day, markedAbsent, carriedLeave });
  } catch (error) {
    console.error("Daily absence processing failed:", error);
    return NextResponse.json({ error: "Unable to process daily attendance statuses." }, { status: 500 });
  }
}

async function clearArrivals(day, start, end) {
  try {
    const result = await prisma.$transaction(async (transaction) => {
      await transaction.dailyJobRun.create({ data: { id: `clear-arrivals:${day}` } });
      const deleted = await transaction.attendance.deleteMany({ where: { timestamp: { gte: start, lt: end } } });
      return deleted.count;
    });
    return NextResponse.json({ status: "cleared", day, deletedAttendanceRecords: result });
  } catch (error) {
    if (error.code === "P2002") return NextResponse.json({ status: "already-cleared", day });
    console.error("Daily attendance cleanup failed:", error);
    return NextResponse.json({ error: "Unable to clear daily attendance records." }, { status: 500 });
  }
}
