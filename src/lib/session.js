import { SignJWT, jwtVerify } from "jose";

const ADMIN_COOKIE = "attendance_admin";
const EMPLOYEE_COOKIE = "attendance_employee";

function getKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || new TextEncoder().encode(secret).length < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 bytes.");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(subject, role, lifetime) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(lifetime)
    .sign(getKey());
}

async function readSession(request, cookieName, role) {
  const token = request.cookies.get(cookieName)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getKey(), { algorithms: ["HS256"] });
    return payload.role === role && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export function getAdminSession(request) {
  return readSession(request, ADMIN_COOKIE, "ADMIN");
}

export function getEmployeeSession(request) {
  return readSession(request, EMPLOYEE_COOKIE, "EMPLOYEE");
}

export function setSessionCookie(response, name, value, maxAge) {
  response.cookies.set(name, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge,
    path: "/",
  });
}

export function isSameOriginRequest(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
