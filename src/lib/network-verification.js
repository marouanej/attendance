/**
 * Browsers cannot reliably read Wi-Fi SSIDs or MAC addresses. This function
 * only accepts a signed response from an office-local verifier service.
 */
export async function verifyOfficeNetwork({ request, mode, verifierUrl, verifierSecret }) {
  if (mode === "GPS_ONLY") return { verified: false, required: false, method: "GPS_ONLY" };
  if (!verifierUrl || !verifierSecret) return { verified: false, required: true, reason: "NETWORK_VERIFIER_NOT_CONFIGURED" };

  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const response = await fetch(verifierUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-attendance-secret": verifierSecret },
    body: JSON.stringify({ ipAddress: forwardedFor }),
    cache: "no-store",
  });
  if (!response.ok) return { verified: false, required: true, reason: "NETWORK_VERIFIER_UNAVAILABLE" };
  const result = await response.json();
  return { verified: result.verified === true, required: true, method: "LOCAL_VERIFIER" };
}
