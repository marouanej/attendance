import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getAdminSession, isSameOriginRequest } from "../../../../lib/session";

export async function POST(request) {
  if (!await getAdminSession(request)) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.agents) || body.agents.length > 1000) return NextResponse.json({ error: "Upload a valid agent list (up to 1,000 rows)." }, { status: 400 });

  const agents = body.agents.map((agent) => {
    const name = typeof agent.name === "string" ? agent.name.trim().replace(/\s+/g, " ") : "";
    const externalId = typeof agent.id === "string" ? agent.id.trim() : "";
    const [firstName, ...lastNameParts] = name.split(" ");
    return { name, firstName, lastName: lastNameParts.join(" "), externalId, department: typeof agent.team === "string" ? agent.team.trim().slice(0, 120) : "" };
  });
  if (agents.some((agent) => agent.name.length > 120 || !agent.firstName || !agent.lastName || !agent.externalId || agent.externalId.length > 120)) {
    return NextResponse.json({ error: "Each agent needs a full name and a unique ID. Include an ID column in your CSV." }, { status: 400 });
  }
  const seenNames = new Set();
  const seenIds = new Set();
  for (const agent of agents) {
    const normalizedName = agent.name.toLowerCase();
    if (seenNames.has(normalizedName) || seenIds.has(agent.externalId)) {
      return NextResponse.json({ error: "Agent names and IDs must be unique in the imported list." }, { status: 400 });
    }
    seenNames.add(normalizedName);
    seenIds.add(agent.externalId);
  }

  try {
    const imported = await prisma.$transaction(async (transaction) => {
      const result = [];
      for (const agent of agents) {
        const employeeNumber = `IMPORT-${agent.externalId}`;
        const emailKey = createHash("sha256").update(employeeNumber).digest("hex").slice(0, 32);
        const internalEmail = `agent-${emailKey}@import.invalid`;
        const existing = await transaction.employee.findUnique({ where: { employeeNumber }, select: { id: true } });
        const normalizedName = `${agent.firstName} ${agent.lastName}`.toLowerCase();
        await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${normalizedName}, 1))`;
        const nameCollision = await transaction.employee.findFirst({
          where: {
            firstName: { equals: agent.firstName, mode: "insensitive" },
            lastName: { equals: agent.lastName, mode: "insensitive" },
            ...(existing ? { id: { not: existing.id } } : {}),
          },
          select: { id: true },
        });
        if (nameCollision) throw new Error("DUPLICATE_AGENT_NAME");
        let employeeId;
        if (existing) {
          await transaction.employee.update({ where: { id: existing.id }, data: { firstName: agent.firstName, lastName: agent.lastName, department: agent.department || null } });
          employeeId = existing.id;
        } else {
          const created = await transaction.user.create({
            data: {
              email: internalEmail,
              role: "EMPLOYEE",
              employee: { create: { employeeNumber, firstName: agent.firstName, lastName: agent.lastName, email: internalEmail, department: agent.department || null } },
            },
            select: { employee: { select: { id: true } } },
          });
          employeeId = created.employee.id;
        }
        result.push({ id: employeeId, name: agent.name, team: agent.department });
      }
      return result;
    });
    return NextResponse.json({ imported: imported.length, agents: imported });
  } catch (error) {
    if (error.message === "DUPLICATE_AGENT_NAME") return NextResponse.json({ error: "An agent with that name already exists under a different ID." }, { status: 409 });
    console.error("Agent import failed:", error);
    return NextResponse.json({ error: "Unable to import agents into the shared database." }, { status: 503 });
  }
}
