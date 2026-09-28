import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getAdminSession } from "../../../../lib/session";

export async function GET(request) {
  if (!await getAdminSession(request)) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [employees, events] = await Promise.all([
      prisma.employee.findMany({ where: { active: true }, select: { id: true, firstName: true, lastName: true, department: true } }),
      prisma.attendance.findMany({
        where: { timestamp: { gte: startOfDay }, verificationStatus: "VERIFIED" },
        include: { employee: { select: { firstName: true, lastName: true, department: true } } },
        orderBy: { timestamp: "desc" },
      }),
    ]);
    return NextResponse.json({
      agents: employees.map((employee) => ({ id: employee.id, name: `${employee.firstName} ${employee.lastName}`, team: employee.department || "" })),
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
