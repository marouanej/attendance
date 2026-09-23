"use client";

import { useState } from "react";

function toBase64Url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===";
  return Uint8Array.from(atob(padded.slice(0, padded.length - (padded.length % 4))), (character) => character.charCodeAt(0));
}

function distanceInMeters(latitude, longitude) {
  const officeLatitude = Number(process.env.NEXT_PUBLIC_OFFICE_LATITUDE);
  const officeLongitude = Number(process.env.NEXT_PUBLIC_OFFICE_LONGITUDE);
  if (!Number.isFinite(officeLatitude) || !Number.isFinite(officeLongitude)) return null;
  const radians = (value) => (value * Math.PI) / 180;
  const a = Math.sin(radians(officeLatitude - latitude) / 2) ** 2 + Math.cos(radians(latitude)) * Math.cos(radians(officeLatitude)) * Math.sin(radians(officeLongitude - longitude) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function CheckInPage() {
  const [step, setStep] = useState("identify");
  const [name, setName] = useState("");
  const [agent, setAgent] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  function findAgent() {
    const agents = JSON.parse(window.localStorage.getItem("attendance-agents") || "[]");
    const match = agents.find((item) => item.name.toLowerCase() === name.trim().toLowerCase());
    if (!match) {
      setError("This name is not on the office agent list. Ask your administrator to add you first.");
      return;
    }
    setAgent(match);
    setError("");
    setStep("biometric");
  }

  async function verifyBiometric() {
    setError("");
    if (!window.PublicKeyCredential || !navigator.credentials) {
      setError("This device does not support passkeys. Use a phone with Face ID, fingerprint, or a device PIN.");
      return;
    }
    try {
      const stored = JSON.parse(window.localStorage.getItem(`passkey-${agent.id}`) || "null");
      if (stored) {
        await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), userVerification: "required", allowCredentials: [{ id: fromBase64Url(stored), type: "public-key" }] } });
      } else {
        const credential = await navigator.credentials.create({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: "Office attendance", id: window.location.hostname }, user: { id: crypto.getRandomValues(new Uint8Array(16)), name: agent.name, displayName: agent.name }, pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }], authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" }, timeout: 60000, attestation: "none" } });
        window.localStorage.setItem(`passkey-${agent.id}`, toBase64Url(credential.rawId));
      }
      setStep("location");
    } catch {
      setError("Biometric verification was cancelled or failed. Please try again on your registered device.");
    }
  }

  function captureLocation() {
    setError("");
    if (!navigator.geolocation) {
      setError("Location is not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition((position) => {
      const { latitude, longitude, accuracy } = position.coords;
      const distance = distanceInMeters(latitude, longitude);
      const radius = Number(process.env.NEXT_PUBLIC_OFFICE_GEOFENCE_RADIUS_METERS || 75);
      if (distance !== null && (distance > radius || accuracy > 100)) {
        setError(distance > radius ? "You are too far from the office. Please move closer and try again." : "GPS accuracy is too low. Move outside or enable precise location, then try again.");
        return;
      }
      const event = { id: crypto.randomUUID(), agentId: agent.id, agentName: agent.name, timestamp: new Date().toISOString(), latitude, longitude, accuracy, distance };
      const events = JSON.parse(window.localStorage.getItem("attendance-events") || "[]");
      window.localStorage.setItem("attendance-events", JSON.stringify([...events, event]));
      setResult(event);
      setStep("complete");
    }, () => setError("Location permission is required. Please enable location access and try again."), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  return <main className="checkin-page"><div className="checkin-brand"><span>◎</span> presence<span>.</span></div><section className="checkin-card"><div className="checkin-kicker">OFFICE ATTENDANCE</div>{step === "identify" && <><h1>Who is checking in?</h1><p className="checkin-copy">Enter your name exactly as it appears on the office agent list. This is only used to find your registered account.</p><label className="checkin-label" htmlFor="agent-name">Your full name</label><input className="checkin-input" id="agent-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Samir Kaci" autoComplete="name" /><button className="checkin-button" onClick={findAgent} disabled={!name.trim()}>Continue <span>→</span></button></>}{step === "biometric" && <><h1>{agent.name}</h1><p className="checkin-copy">First scan: register this phone with your passkey. Returning scans will verify this same device.</p><div className="checkin-step"><span className="step-current">1</span><div><strong>Biometric or device PIN</strong><small>Face ID, fingerprint, or phone passcode</small></div></div><button className="checkin-button" onClick={verifyBiometric}>Register / verify passkey <span>→</span></button></>}{step === "location" && <><h1>One last check.</h1><p className="checkin-copy">Your identity is verified. Allow location access so the server can confirm you are at the office.</p><div className="checkin-step"><span className="step-done">✓</span><div><strong>Passkey verified</strong><small>Biometric data stayed on your device</small></div></div><div className="checkin-step"><span className="step-current">2</span><div><strong>GPS location</strong><small>Latitude, longitude, accuracy, and time</small></div></div><button className="checkin-button" onClick={captureLocation}>Confirm my arrival <span>→</span></button></>}{step === "complete" && result && <><div className="complete-icon">✓</div><h1>You arrived.</h1><p className="checkin-copy">Your attendance was recorded at the office.</p><div className="arrival-details"><div><span>ARRIVAL TIME</span><strong>{new Date(result.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong></div><div><span>GPS ACCURACY</span><strong>{Math.round(result.accuracy)}m</strong></div><div><span>LOCATION</span><strong>{result.distance === null ? "Captured" : `${Math.round(result.distance)}m from office`}</strong></div></div><p className="checkin-privacy">Server time and location verification were saved with your attendance record.</p></>}{error && <div className="notice notice-error">{error}</div>}</section><p className="checkin-help">Need help? Contact your office administrator</p></main>;
}
