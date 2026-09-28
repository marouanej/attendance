"use client";

import { useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

function CheckInShell({ children, error }) {
  return <main className="checkin-page"><div className="checkin-brand"><span>◎</span> presence<span>.</span></div><section className="checkin-card"><div className="checkin-kicker">OFFICE ATTENDANCE</div>{children}{error && <div className="notice notice-error">{error}</div>}</section><p className="checkin-help">Need help? Contact your office administrator</p></main>;
}

export default function CheckInPage() {
  const [step, setStep] = useState("identify");
  const [name, setName] = useState("");
  const [enrollmentCode, setEnrollmentCode] = useState("");
  const [agent, setAgent] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [serverFlow, setServerFlow] = useState(null);
  const [serverOptions, setServerOptions] = useState(null);
  const [isBusy, setIsBusy] = useState(false);

  async function findAgent() {
    setError("");
    setIsBusy(true);
    try {
      let response = await fetch("/api/checkin/auth/options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      let data = await response.json().catch(() => ({}));
      if (response.status === 409 && data.status === "NO_PASSKEY") {
        setAgent({ name: name.trim(), server: true });
        setStep("enrollment-code");
        return;
      } else {
        if (!response.ok) throw new Error(data.error || "Unable to find your registered account.");
        setServerFlow("authentication");
      }
      setAgent({ name: name.trim(), server: true });
      setServerOptions(data);
      setStep("biometric");
    } catch (requestError) {
      setError(requestError.message || "Unable to connect to attendance services.");
    } finally {
      setIsBusy(false);
    }
  }

  async function startEnrollment() {
    setError("");
    setIsBusy(true);
    try {
      const response = await fetch("/api/checkin/enrollment/options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: agent.name, code: enrollmentCode }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to start enrollment.");
      setServerFlow("enrollment");
      setServerOptions(data);
      setStep("biometric");
    } catch (requestError) {
      setError(requestError.message || "Unable to start enrollment.");
    } finally {
      setIsBusy(false);
    }
  }

  async function verifyBiometric() {
    setError("");
    setIsBusy(true);
    if (!window.PublicKeyCredential || !navigator.credentials) {
      setError("This device does not support passkeys. Use a phone with Face ID, fingerprint, or a device PIN.");
      setIsBusy(false);
      return;
    }
    try {
      if (agent.server && serverFlow === "enrollment") {
        const passkeyResponse = await startRegistration({ optionsJSON: serverOptions.options });
        const response = await fetch("/api/checkin/enrollment/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ challengeId: serverOptions.challengeId, response: passkeyResponse }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Unable to complete enrollment.");
        setResult({ ...data, pending: true });
        setStep("complete");
        return;
      }
      if (agent.server && serverFlow === "authentication") {
        const assertion = await startAuthentication({ optionsJSON: serverOptions.options });
        const response = await fetch("/api/checkin/auth/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ challengeId: serverOptions.challengeId, response: assertion }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Passkey verification failed.");
        setStep("location");
        return;
      }
      throw new Error("Passkey flow is not ready. Start again.");
    } catch (verificationError) {
      setError(verificationError.message || "Biometric verification was cancelled or failed. Please try again.");
    } finally {
      setIsBusy(false);
    }
  }

  function captureLocation() {
    setError("");
    if (!navigator.geolocation) {
      setError("Location is not available in this browser.");
      return;
    }
    setIsBusy(true);
    navigator.geolocation.getCurrentPosition(async (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      try {
        const response = await fetch("/api/checkin/attendance", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ location: { latitude, longitude, accuracy } }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Unable to complete check-in.");
        setResult({ ...data, agentName: agent.name, accuracy: data.accuracy ?? accuracy, distance: data.distance });
        setStep("complete");
      } catch (requestError) {
        setError(requestError.message || "Unable to complete check-in.");
      } finally {
        setIsBusy(false);
      }
    }, () => { setError("Location permission is required. Please enable location access and try again."); setIsBusy(false); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  if (agent?.server && step === "biometric") {
    const registering = serverFlow === "enrollment";
    return <CheckInShell error={error}><h1>{registering ? "Register your phone." : "Verify your identity."}</h1><p className="checkin-copy">{registering ? "Create a passkey with your phone’s biometric or secure screen lock. Your enrollment will wait for administrator approval." : "Use the passkey registered to this agent account."}</p><div className="checkin-step"><span className="step-current">1</span><div><strong>Passkey</strong><small>Face ID, fingerprint, or device PIN</small></div></div><button className="checkin-button" onClick={verifyBiometric} disabled={isBusy}>{isBusy ? "Waiting for your phone..." : registering ? "Register passkey" : "Verify passkey"}<span>→</span></button></CheckInShell>;
  }

  if (agent?.server && step === "enrollment-code") {
    return <CheckInShell error={error}><h1>Enter your setup code.</h1><p className="checkin-copy">Passkey setup is limited to agents on the office roster. Enter the one-time code your administrator gave you.</p><label className="checkin-label" htmlFor="enrollment-code">One-time code</label><input className="checkin-input" id="enrollment-code" value={enrollmentCode} onChange={(event) => setEnrollmentCode(event.target.value.toUpperCase().replace(/\s+/g, ""))} autoComplete="one-time-code" spellCheck="false" required /><button className="checkin-button" onClick={startEnrollment} disabled={isBusy || !enrollmentCode.trim()}>{isBusy ? "Checking code..." : "Continue to passkey setup"}<span>→</span></button></CheckInShell>;
  }

  if (agent?.server && step === "location") {
    return <CheckInShell error={error}><h1>One last check.</h1><p className="checkin-copy">Allow precise location so the server can confirm you are inside the office geofence.</p><div className="checkin-step"><span className="step-done">✓</span><div><strong>Passkey verified</strong><small>Biometric data stays on your device</small></div></div><div className="checkin-step"><span className="step-current">2</span><div><strong>Office location</strong><small>GPS coordinates and accuracy checked by server</small></div></div><button className="checkin-button" onClick={captureLocation} disabled={isBusy}>{isBusy ? "Checking location..." : "Confirm my arrival"}<span>→</span></button></CheckInShell>;
  }

  if (result?.pending) {
    return <CheckInShell><div className="complete-icon">✓</div><h1>Passkey registered.</h1><p className="checkin-copy">Your administrator must approve your identity before check-ins are enabled.</p><div className="checkin-step"><span className="step-current">✓</span><div><strong>{result.name}</strong><small>Awaiting administrator approval</small></div></div></CheckInShell>;
  }

  return <main className="checkin-page"><div className="checkin-brand"><span>◎</span> presence<span>.</span></div><section className="checkin-card"><div className="checkin-kicker">OFFICE ATTENDANCE</div>{step === "identify" && <><h1>Who is checking in?</h1><p className="checkin-copy">Enter your name exactly as it appears on the office agent list. This is only used to find your registered account.</p><label className="checkin-label" htmlFor="agent-name">Your full name</label><input className="checkin-input" id="agent-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Samir Kaci" autoComplete="name" /><button className="checkin-button" onClick={findAgent} disabled={!name.trim() || isBusy}>{isBusy ? "Checking..." : "Continue"} <span>→</span></button></>}{step === "biometric" && <><h1>{agent.name}</h1><p className="checkin-copy">First scan: register this phone with your passkey. Returning scans will verify this same device.</p><div className="checkin-step"><span className="step-current">1</span><div><strong>Biometric or device PIN</strong><small>Face ID, fingerprint, or phone passcode</small></div></div><button className="checkin-button" onClick={verifyBiometric}>Register / verify passkey <span>→</span></button></>}{step === "location" && <><h1>One last check.</h1><p className="checkin-copy">Your identity is verified. Allow location access so the server can confirm you are at the office.</p><div className="checkin-step"><span className="step-done">✓</span><div><strong>Passkey verified</strong><small>Biometric data stayed on your device</small></div></div><div className="checkin-step"><span className="step-current">2</span><div><strong>GPS location</strong><small>Latitude, longitude, accuracy, and time</small></div></div><button className="checkin-button" onClick={captureLocation}>Confirm my arrival <span>→</span></button></>}{step === "complete" && result && <><div className="complete-icon">✓</div><h1>You arrived.</h1><p className="checkin-copy">Your attendance was recorded at the office.</p><div className="arrival-details"><div><span>ARRIVAL TIME</span><strong>{new Date(result.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong></div><div><span>GPS ACCURACY</span><strong>{Math.round(result.accuracy)}m</strong></div><div><span>LOCATION</span><strong>{result.distance === null ? "Captured" : `${Math.round(result.distance)}m from office`}</strong></div></div><p className="checkin-privacy">Server time and location verification were saved with your attendance record.</p></>}{error && <div className="notice notice-error">{error}</div>}</section><p className="checkin-help">Need help? Contact your office administrator</p></main>;
}
