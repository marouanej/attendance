"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginChecked, setLoginChecked] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [agents, setAgents] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [pendingEnrollments, setPendingEnrollments] = useState([]);
  const [importMessage, setImportMessage] = useState("");
  const [leaveDurations, setLeaveDurations] = useState({});
  const [savingStatuses, setSavingStatuses] = useState({});
  const [enrollmentCodes, setEnrollmentCodes] = useState({});
  const [qrDataUrl, setQrDataUrl] = useState("");
  const checkInUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/checkin`;
  useEffect(() => {
    QRCode.toDataURL(checkInUrl, { width: 320, margin: 4, errorCorrectionLevel: "H", color: { dark: "#242431", light: "#ffffff" } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [checkInUrl]);

  useEffect(() => {
    async function restoreAdminSession() {
      try {
        const response = await fetch("/api/admin/attendance", { cache: "no-store" });
        setIsAuthenticated(response.ok);
      } catch {
        setIsAuthenticated(false);
      }
      setLoginChecked(true);
    }
    restoreAdminSession();
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    let cancelled = false;
    async function loadServerData() {
      const [attendanceResponse, enrollmentResponse] = await Promise.all([
        fetch("/api/admin/attendance", { cache: "no-store" }),
        fetch("/api/admin/enrollments", { cache: "no-store" }),
      ]);
      if (cancelled) return;
      if (attendanceResponse.ok) {
        const data = await attendanceResponse.json();
        setAgents(data.agents);
        setLeaveDurations((current) => ({ ...current, ...Object.fromEntries(data.agents.filter((agent) => agent.durationHours).map((agent) => [agent.id, String(agent.durationHours)])) }));
        setAttendance(data.attendance);
      }
      if (enrollmentResponse.ok) setPendingEnrollments(await enrollmentResponse.json());
    }
    loadServerData().catch(() => {});
    const refreshTimer = window.setInterval(() => loadServerData().catch(() => {}), 60_000);
    return () => { cancelled = true; window.clearInterval(refreshTimer); };
  }, [isAuthenticated]);

  const attendanceRows = agents.map((agent) => {
    const event = attendance.find((item) => item.agentId === agent.id);
    const checkIn = event ? new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-";
    const dayStatus = event ? "PRESENT" : agent.dayStatus || "NOT_ARRIVED";
    const statusLabels = { PRESENT: "Present", NOT_ARRIVED: "Not arrived", PERMISSION: "Permission", RECUPERATION: "Recuperation", ABSENT: "Absent" };
    const tone = dayStatus === "PRESENT" ? "green" : dayStatus === "PERMISSION" ? "blue" : ["RECUPERATION", "ABSENT"].includes(dayStatus) ? "orange" : "gray";
    return { ...agent, checkIn, checkOut: "-", distance: event?.distance, accuracy: event?.accuracy, dayStatus, status: statusLabels[dayStatus] || "Not arrived", statusLabel: statusLabels[dayStatus] || "Not arrived", tone, initials: agent.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() };
  });

  function importAgents(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const lines = String(reader.result).split(/\r?\n/).filter(Boolean);
      const headers = lines.shift().split(",").map((header) => header.trim().toLowerCase());
      const nameIndex = headers.findIndex((header) => ["name", "full name", "agent name"].includes(header));
      if (nameIndex < 0) { setImportMessage("CSV must include a Name column."); return; }
      const imported = lines.map((line, index) => {
        const values = line.split(",").map((value) => value.trim().replace(/^"|"$/g, ""));
        return { id: values[headers.indexOf("id")] || `agent-${Date.now()}-${index}`, name: values[nameIndex], team: values[headers.indexOf("department")] || values[headers.indexOf("team")] || "", active: true };
      }).filter((agent) => agent.name);
      const response = await fetch("/api/admin/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agents: imported }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setImportMessage(result.error || "Unable to import agents.");
        return;
      }
      setAgents(result.agents);
      setImportMessage(`${result.imported} agent${result.imported === 1 ? "" : "s"} imported to the shared attendance list.`);
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  function exportCsv() {
    const csv = ["Agent,Department,Check in,Check out,Status,Distance from office (m),GPS accuracy (m)", ...attendanceRows.map((row) => `${row.name},${row.team},${row.checkIn},${row.checkOut},${row.statusLabel},${row.distance === undefined ? "" : Math.round(row.distance)},${row.accuracy ?? ""}`)].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = `attendance-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    setShowToast(true);
    window.setTimeout(() => setShowToast(false), 2800);
  }

  async function login(event) {
    event.preventDefault();
    setIsLoggingIn(true);
    setLoginError("");
    const response = await fetch("/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      setLoginError(result.error || "Unable to sign in.");
      setIsLoggingIn(false);
      return;
    }
    setIsAuthenticated(true);
    setIsLoggingIn(false);
  }

  async function approveEnrollment(id) {
    const enrollment = pendingEnrollments.find((item) => item.id === id);
    if (!window.confirm(`Have you verified ${enrollment?.name || "this agent"} against their official identity or roster ID in person?`)) return;
    const response = await fetch(`/api/admin/enrollments/${id}/approve`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setImportMessage(data.error || "Unable to approve enrollment.");
      return;
    }
    setPendingEnrollments((current) => current.filter((enrollment) => enrollment.id !== id));
    if (enrollment) setAgents((current) => current.some((agent) => agent.id === id) ? current : [...current, { id, name: enrollment.name, team: enrollment.department || "" }]);
    setImportMessage("Agent approved. They can now check in with their passkey.");
  }

  async function setAgentDayStatus(employeeId, status, selectedDurationHours) {
    if (!status) return;
    setSavingStatuses((current) => ({ ...current, [employeeId]: true }));
    const durationHours = Number(selectedDurationHours || leaveDurations[employeeId] || 24);
    try {
      const response = await fetch(`/api/admin/agents/${employeeId}/day-status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, durationHours }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to update agent status.");
      setAgents((current) => current.map((agent) => agent.id === employeeId ? { ...agent, dayStatus: data.status, validUntil: data.validUntil, durationHours: data.durationHours } : agent));
      setImportMessage(`${status === "PERMISSION" ? "Permission" : status === "RECUPERATION" ? "Recuperation" : "Absent"} status saved for ${attendanceRows.find((row) => row.id === employeeId)?.name || "agent"}.`);
    } catch (error) {
      setImportMessage(error.message || "Unable to update agent status.");
    } finally {
      setSavingStatuses((current) => ({ ...current, [employeeId]: false }));
    }
  }

  async function issueEnrollmentCode(employeeId) {
    setSavingStatuses((current) => ({ ...current, [employeeId]: true }));
    try {
      const response = await fetch(`/api/admin/agents/${employeeId}/enrollment-code`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to issue setup code.");
      setEnrollmentCodes((current) => ({ ...current, [employeeId]: data }));
    } catch (error) {
      setImportMessage(error.message || "Unable to issue setup code.");
    } finally {
      setSavingStatuses((current) => ({ ...current, [employeeId]: false }));
    }
  }

  async function copyEnrollmentCode(employeeId) {
    const code = enrollmentCodes[employeeId]?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setImportMessage("One-time passkey setup code copied.");
    } catch {
      setImportMessage("Copy the displayed code and give it directly to the employee.");
    }
  }

  function printQr() {
    if (!qrDataUrl) return;
    const printWindow = window.open("", "attendance-qr-print", "width=800,height=900");
    if (!printWindow) {
      setShowToast(true);
      window.setTimeout(() => setShowToast(false), 2800);
      return;
    }
    const safeUrl = checkInUrl.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
    printWindow.document.write(`<!doctype html><html><head><title>Office check-in QR code</title><style>html,body{margin:0;min-height:100%;font-family:Arial,sans-serif}body{display:flex;min-height:100vh;align-items:center;justify-content:center}.sheet{text-align:center}.sheet img{display:block;width:180mm;height:180mm;image-rendering:pixelated}.sheet p{font-size:12pt;margin:18px 0 0}@media print{.sheet img{width:180mm;height:180mm}}</style></head><body><main class="sheet"><img src="${qrDataUrl}" alt="Office check-in QR code"><p>${safeUrl}</p></main></body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.onload = () => {
      printWindow.print();
      printWindow.onafterprint = () => printWindow.close();
    };
  }

  if (!loginChecked) return null;
  if (!isAuthenticated) return <main className="admin-login"><form className="login-card" onSubmit={login}><div className="checkin-brand login-brand"><span>◎</span> presence<span>.</span></div><div className="checkin-kicker">ADMINISTRATION</div><h1>Sign in to your workspace.</h1><p className="checkin-copy">Use the administrator username and password configured for this deployment.</p><label className="checkin-label" htmlFor="admin-username">Username</label><input className="checkin-input" id="admin-username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /><label className="checkin-label login-password-label" htmlFor="admin-password">Password</label><input className="checkin-input" id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />{loginError && <div className="notice notice-error">{loginError}</div>}<button className="checkin-button" disabled={isLoggingIn}>{isLoggingIn ? "Signing in..." : "Sign in"}<span>→</span></button></form></main>;

  return (
    <div className="app-shell">
      <main className="main-content">
        <header className="topbar simple-topbar"><div className="brand"><span className="brand-mark">◎</span><span>presence<span className="brand-dot">.</span></span></div><span className="admin-label">ADMIN PANEL</span></header>

        <div className="content-wrap">
          <section className="page-heading"><div><p className="eyebrow" suppressHydrationWarning>{new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" }).toUpperCase()}</p><h1>Attendance</h1><p className="subheading">Import agents and review verified arrivals.</p></div><div className="heading-actions"><button className="button button-secondary" onClick={exportCsv} disabled={!attendanceRows.length}><span>↓</span> Export CSV</button><label className="button button-primary file-button"><span>↑</span> Import CSV<input type="file" accept=".csv,text/csv" onChange={importAgents} /></label></div></section>

          {importMessage && <div className="import-message">{importMessage}</div>}

          {pendingEnrollments.length > 0 && <section className="panel pending-enrollments"><div className="panel-header"><div><h2>Pending agent approvals</h2><p>Verify the person in person against official ID before activation.</p></div><span className="live-badge">{pendingEnrollments.length} waiting</span></div><div className="activity-list">{pendingEnrollments.map((enrollment) => <div key={enrollment.id}><span className="activity-icon blue-icon">♙</span><p><strong>{enrollment.name}</strong><small>{enrollment.rosterId ? `Roster ID ${enrollment.rosterId}` : "New agent enrollment"} · passkey registered · {new Date(enrollment.createdAt).toLocaleString()}</small></p><button className="button button-primary approve-button" onClick={() => approveEnrollment(enrollment.id)}>Approve</button></div>)}</div></section>}

          <section className="stats-grid" aria-label="Attendance summary">
            <div className="stat-card"><div className="stat-top"><span>Arrived today</span><span className="stat-icon green-icon">✓</span></div><strong>{attendanceRows.filter((row) => row.dayStatus === "PRESENT").length}<span className="stat-denom"> / {agents.length}</span></strong><div className="stat-foot">Recorded from verified scans</div></div>
            <div className="stat-card"><div className="stat-top"><span>Agents imported</span><span className="stat-icon blue-icon">♙</span></div><strong>{agents.length}</strong><div className="stat-foot">Registered in workspace</div></div>
            <div className="stat-card"><div className="stat-top"><span>Waiting to arrive</span><span className="stat-icon orange-icon">◷</span></div><strong>{agents.length - attendanceRows.filter((row) => row.dayStatus === "PRESENT").length}</strong><div className="stat-foot">Not yet checked in</div></div>
            <div className="stat-card"><div className="stat-top"><span>GPS verified</span><span className="stat-icon violet-icon">↗</span></div><strong>{attendance.length ? "100" : "0"}<span className="percent">%</span></strong><div className="stat-foot">Server-side location check</div></div>
          </section>

          <section className="panel day-status-panel"><div className="panel-header"><div><h2>Non-arrival status</h2><p>Set permission, recuperation, or absent for employees who have not checked in. Issue private setup codes for rostered agents without passkeys.</p></div></div><div className="day-status-list">{attendanceRows.filter((row) => row.dayStatus !== "PRESENT").length ? attendanceRows.filter((row) => row.dayStatus !== "PRESENT").map((row) => <div className="day-status-row" key={row.id}><div className="day-status-agent"><strong>{row.name}</strong><small>{row.team || "No department"}{row.validUntil && ["PERMISSION", "RECUPERATION"].includes(row.dayStatus) ? ` · ${row.durationHours || leaveDurations[row.id] || 24} hours, until ${new Date(row.validUntil).toLocaleString("en-GB", { timeZone: "Africa/Casablanca", dateStyle: "medium", timeStyle: "short" })}` : ""}</small></div><select aria-label={`Status for ${row.name}`} value={["PERMISSION", "RECUPERATION", "ABSENT"].includes(row.dayStatus) ? row.dayStatus : ""} disabled={savingStatuses[row.id]} onChange={(event) => setAgentDayStatus(row.id, event.target.value)}><option value="" disabled>Choose status</option><option value="PERMISSION">Permission</option><option value="RECUPERATION">Recuperation</option><option value="ABSENT">Absent</option></select>{["PERMISSION", "RECUPERATION"].includes(row.dayStatus) && <select aria-label={`Duration for ${row.name}`} value={leaveDurations[row.id] || String(row.durationHours || 24)} disabled={savingStatuses[row.id]} onChange={(event) => { const durationHours = event.target.value; setLeaveDurations((current) => ({ ...current, [row.id]: durationHours })); setAgentDayStatus(row.id, row.dayStatus, durationHours); }}><option value="24">24 hours</option><option value="72">72 hours</option><option value="96">4 days</option></select>}{row.canIssueEnrollmentCode && <button className="button button-secondary enrollment-code-button" disabled={savingStatuses[row.id]} onClick={() => issueEnrollmentCode(row.id)}>{savingStatuses[row.id] ? "Issuing..." : "Issue setup code"}</button>}{enrollmentCodes[row.id] && <div className="issued-code"><code>{enrollmentCodes[row.id].code}</code><button className="button button-secondary" onClick={() => copyEnrollmentCode(row.id)}>Copy</button><small>Valid until {new Date(enrollmentCodes[row.id].expiresAt).toLocaleString("en-GB", { timeZone: "Africa/Casablanca", dateStyle: "medium", timeStyle: "short" })}. Give this code directly to the named employee.</small></div>}</div>) : <p className="empty-cell">Everyone has checked in.</p>}</div></section>

          <div className="dashboard-grid">
            <section className="panel attendance-panel"><div className="panel-header"><div><h2>Today&apos;s attendance</h2><p>Arrivals appear after a verified QR scan.</p></div></div><div className="table-tools"><label className="search"><span>⌕</span><input placeholder="Search agents..." /></label></div><div className="table-scroll"><table><thead><tr><th>AGENT</th><th>ARRIVED</th><th>DISTANCE</th><th>STATUS</th></tr></thead><tbody>{attendanceRows.length ? attendanceRows.map((row) => <tr key={row.name}><td><div className="employee-cell"><span className={`avatar avatar-${row.tone}`}>{row.initials}</span><span><strong>{row.name}</strong><small>{row.team || "No department"}</small></span></div></td><td className={row.checkIn === "-" ? "muted" : ""}>{row.checkIn}</td><td className={row.checkIn === "-" ? "muted" : "gps-ok"}>{row.distance === undefined ? "-" : `${Math.round(row.distance)} m`}</td><td><span className={`status-pill ${row.tone}`}>{row.status}</span></td></tr>) : <tr><td colSpan="4" className="empty-cell">No agents yet. Import a CSV file to create your attendance list.</td></tr>}</tbody></table></div></section>

            <section className="panel qr-panel"><div className="panel-header"><div><h2>Office QR code</h2><p>Permanent check-in link</p></div></div><div className="qr-content"><div className="qr-code" aria-label="Permanent office check-in QR code">{qrDataUrl ? <Image src={qrDataUrl} alt="Scan to open office check-in" width={320} height={320} unoptimized /> : <span className="qr-loading">Generating QR...</span>}</div><p>Agents scan this code to open<br /><strong>the attendance page</strong></p><span className="qr-url">{checkInUrl}</span></div><button className="print-button" onClick={printQr} disabled={!qrDataUrl}><span>▣</span> Print QR code</button><p className="qr-footnote">This QR code does not change.</p></section>
          </div>
        </div>
      </main>
      {showToast && <div className="toast">Attendance CSV exported successfully <span>✓</span></div>}
    </div>
  );
}
