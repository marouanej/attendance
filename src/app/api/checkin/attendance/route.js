import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getOfficeConfig } from "../../../../lib/config";
import { validateCoordinates } from "../../../../lib/geofence";
import { verifyOfficeNetwork } from "../../../../lib/network-verification";
import { getEmployeeSession, isSameOriginRequest } from "../../../../lib/session";
import { getCasablancaHour } from "../../../../lib/casablanca-time";

export async function POST(request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const employeeId = await getEmployeeSession(request);
  if (!employeeId) return NextResponse.json({ error: "Verify your passkey before checking in." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  try {
    const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, active: true } });
    if (!employee?.active) return NextResponse.json({ error: "This agent is not active." }, { status: 403 });
    if (getCasablancaHour() >= 18) return NextResponse.json({ error: "Today's check-in window closed at 18:00 Casablanca time." }, { status: 403 });
    const office = getOfficeConfig();
    const location = validateCoordinates(body.location || {}, {
      latitude: office.officeLatitude,
      longitude: office.officeLongitude,
      radius: office.geofenceRadius,
      maxAccuracy: office.maxGpsAccuracy,
    });
    if (!location.ok) {
      return NextResponse.json({ error: location.reason === "OUTSIDE_GEOFENCE" ? "You are outside the office attendance area." : "GPS accuracy is too low. Enable precise location and try again." }, { status: 403 });
    }

    const network = await verifyOfficeNetwork({
      request,
      mode: office.networkMode,
      verifierUrl: process.env.LOCAL_NETWORK_VERIFIER_URL,
      verifierSecret: process.env.LOCAL_NETWORK_VERIFIER_SECRET,
    });
    if (network.required && !network.verified) return NextResponse.json({ error: "Office network verification failed." }, { status: 403 });

    const attendance = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${employeeId}, 0))`;
      const now = new Date();
      const lastCheckIn = await transaction.attendance.findFirst({
        where: { employeeId, eventType: "CHECK_IN", timestamp: { gte: new Date(now.getTime() - office.minimumScanInterval * 1000) } },
        select: { id: true },
      });
      if (lastCheckIn) throw new Error("DUPLICATE_CHECKIN");

      return transaction.attendance.create({
        data: {
          employeeId,
          eventType: "CHECK_IN",
          timestamp: now,
          latitude: location.latitude,
          longitude: location.longitude,
          gpsAccuracy: location.accuracy,
          distanceFromOffice: location.distance,
          authenticationMethod: "PASSKEY",
          verificationStatus: "VERIFIED",
          networkVerified: network.verified,
        },
        select: { id: true, timestamp: true, gpsAccuracy: true, distanceFromOffice: true },
      });
    });
    return NextResponse.json({
      id: attendance.id,
      timestamp: attendance.timestamp,
      accuracy: Number(attendance.gpsAccuracy),
      distance: Number(attendance.distanceFromOffice),
    });
  } catch (error) {
    if (error.message === "DUPLICATE_CHECKIN") return NextResponse.json({ error: "A check-in was already recorded recently." }, { status: 409 });
    console.error("Attendance check-in failed:", error);
    return NextResponse.json({ error: "Unable to record attendance. Check server configuration." }, { status: 503 });
  }
}
