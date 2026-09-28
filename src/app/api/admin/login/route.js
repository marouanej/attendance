import { NextResponse } from "next/server";
import { createSessionToken, isSameOriginRequest, setSessionCookie } from "../../../../lib/session";

export async function POST(request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Admin credentials are not configured." }, { status: 503 });
  }

  if (username !== process.env.ADMIN_USERNAME || password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  try {
    const token = await createSessionToken(username, "ADMIN", "8h");
    const response = NextResponse.json({ ok: true });
    setSessionCookie(response, "attendance_admin", token, 8 * 60 * 60);
    return response;
  } catch {
    return NextResponse.json({ error: "Admin session security is not configured." }, { status: 503 });
  }
}
