import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getAdminSession } from "../../../../lib/session";

export async function GET(request) {
  if (!await getAdminSession(request)) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  try {
    const employees = await prisma.employee.findMany({
      where: { active: false, removedAt: null },
      select: { id: true, firstName: true, lastName: true, department: true, employeeNumber: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json(employees.map((employee) => ({
      ...employee,
      name: `${employee.firstName} ${employee.lastName}`,
      rosterId: employee.employeeNumber.startsWith("IMPORT-") ? employee.employeeNumber.slice(7) : null,
      isNewAgent: employee.employeeNumber.startsWith("PENDING-"),
    })));
  } catch (error) {
    console.error("Pending enrollment lookup failed:", error);
    return NextResponse.json({ error: "Unable to load pending enrollments." }, { status: 503 });
  }
}
