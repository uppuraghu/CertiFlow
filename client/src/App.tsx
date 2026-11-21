
import React, { useCallback, useEffect, useState } from "react";

const API = "http://localhost:4000/api";
const demos = ["anika", "dev", "meera", "kabir", "neha", "farah"];

const roleLabels: Record<string, string> = {
  CENTRE: "Centre Operator",
  DISTRICT: "District Reviewer",
  QUALITY: "Quality Team",
  STATE: "State Authority",
};

const workflow = ["DRAFT", "SUBMITTED", "DISTRICT_REVIEW", "QUALITY_REVIEW", "STATE_REVIEW", "APPROVED"];

function prettyStatus(status: string) {
  return (status || "UNKNOWN").replaceAll("_", " ");
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [user, setUser] = useState<any>(null);
//   const [batches, setBatches] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const [selected, setSelected] = useState("");
  const [csv, setCsv] = useState<File | null>(null);
  const [name, setName] = useState("Demo Batch");
  const [verifyToken, setVerifyToken] = useState("");
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState<any>(null);
  const [section, setSection] = useState("Dashboard");
  const [batches, setBatches] = useState<any[]>([]);
const [certificates, setCertificates] = useState<any[]>([]);
const [previewCert, setPreviewCert] = useState<any>(null);
  const [stalledBatches, setStalledBatches] = useState<any[]>([]);
  const [apiStatus, setApiStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const call = useCallback(async (path: string, body?: any, method = "POST") => {
    let r: Response;
    try {
      r = await fetch(API + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      setApiStatus("offline");
      throw error;
    }

    setApiStatus("live");
    setLastSync(new Date());
    const d = await r.json();
    if (!r.ok) throw Error(d.error || JSON.stringify(d.errors || d));
    return d;
  }, [token]);

  const refresh = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const d = await call("/batches", undefined, "GET");
      setBatches(Array.isArray(d) ? d : []);
    } catch (e: any) {
      if (!silent) setMsg(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [call]);
  const loadCertificates = useCallback(async () => {
    try {
      const d = await call("/certificates", undefined, "GET");
      setCertificates(Array.isArray(d) ? d : []);
    } catch (e: any) {
      setMsg(e.message);
    }
  }, [call]);

  const loadStalledBatches = useCallback(async () => {
    try {
      const d = await call("/batches/stalled", undefined, "GET");
      setStalledBatches(Array.isArray(d.batches) ? d.batches : []);
    } catch (e: any) {
      setMsg(e.message);
    }
  }, [call]);

  async function login(username: string) {
    try {
      setBusy(true);
      const d = await call("/login", { username });
      localStorage.setItem("token", d.token);
      setToken(d.token);
      setUser(d.user);
      setMsg("Welcome, " + d.user.name);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!token) return;

    call("/me", undefined, "GET")
      .then(setUser)
      .catch(() => {
        localStorage.removeItem("token");
        setToken("");
        setUser(null);
      });

    refresh();
  }, [token, call, refresh]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => {
      void refresh(true);
      if (section === "Certificates") void loadCertificates();
      if (user.role === "STATE") void loadStalledBatches();
    }, 10000);
    return () => clearInterval(timer);
  }, [user, section, refresh, loadCertificates, loadStalledBatches]);

  useEffect(() => {
    if (user?.role === "STATE") void loadStalledBatches();
  }, [user, loadStalledBatches]);

  async function act(path: string, body: any = {}) {
    try {
      setBusy(true);
      await call(path, body);
      setMsg("Workflow action completed successfully.");
      await refresh(true);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function importCsv() {
    if (!csv) {
      setMsg("Please select a CSV file first.");
      return;
    }

    try {
      setBusy(true);
      const fd = new FormData();
      fd.append("file", csv);
      fd.append("name", name);

      const r = await fetch(API + "/batches/import", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: fd,
      });

      const d = await r.json();
      if (!r.ok) throw Error(d.error || JSON.stringify(d));

      setMsg("Successfully imported " + d.size + " candidates.");
      setCsv(null);
      await refresh(true);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadAudit(batchId: string) {
    try {
      const d = await call("/audit/" + batchId, undefined, "GET");
      setAudit(d);
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  async function cancelCertificate(certificateId: string) {
    if (!window.confirm("Cancel this certificate? Public verification will mark it as revoked.")) return;

    try {
      setBusy(true);
      await call(`/certificates/${certificateId}/cancel`);
      setMsg("Certificate cancelled. Verification now reports it as revoked.");
      await loadCertificates();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyCertificate() {
    if (!verifyToken.trim()) {
      setMsg("Enter a certificate verification token.");
      return;
    }

    try {
      setBusy(true);
      setVerifyResult(null);
      const r = await fetch(API + "/certificates/" + encodeURIComponent(verifyToken.trim()) + "/verify");
      const d = await r.json();
      setVerifyResult({ ok: r.ok, data: d });
    } catch (e: any) {
      setVerifyResult({ ok: false, data: { error: e.message } });
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    localStorage.removeItem("token");
    setToken("");
    setUser(null);
    setBatches([]);
    setCertificates([]);
    setStalledBatches([]);
    setSelected("");
    setAudit(null);
    setVerifyResult(null);
    setMsg("");
    setApiStatus("connecting");
    setLastSync(null);
  }

  const total = batches.length;
  const pending = batches.filter(b => !["APPROVED", "ISSUED", "REJECTED"].includes(b.status)).length;
  const approved = batches.filter(b => ["APPROVED", "ISSUED"].includes(b.status)).length;
  const returned = batches.filter(b => b.status === "RETURNED").length;

  const filtered = batches.filter(b => {
    const matchesSearch =
      (b.name || "").toLowerCase().includes(search.toLowerCase()) ||
      (b.id || "").toLowerCase().includes(search.toLowerCase());

    const matchesFilter = filter === "ALL" || b.status === filter;
    return matchesSearch && matchesFilter;
  });

  if (!user) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="brand-mark">CF</div>
          <h1>CertiFlow</h1>
          <p className="muted">Skills certification and approval platform</p>
          <div className="login-divider" />
          <h3>Demo workspace</h3>
          <p className="muted">Choose a role to explore the workflow.</p>
          <div className="personas">
            {demos.map(x => (
              <button disabled={busy} key={x} onClick={() => login(x)}>
                <span className="avatar">{x[0].toUpperCase()}</span>
                <span>{x[0].toUpperCase() + x.slice(1)}</span>
                <span className="arrow">→</span>
              </button>
            ))}
          </div>
          {msg && <div className="notice">{msg}</div>}
          <div className="login-foot">LOCAL DEMO ENVIRONMENT</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="side-brand">
          <div className="brand-mark">CF</div>
          <div>
            <strong>CertiFlow</strong>
            <small>Certification system</small>
          </div>
        </div>

        <div className="nav-label">WORKSPACE</div>
        {["Dashboard", "Batches", "Certificates", "Verification", "Audit"].map(item => (
          <button
            className={"nav-item " + (section === item ? "active" : "")}
            key={item}
            onClick={() => {
  setSection(item);
  if (item === "Certificates") loadCertificates();
}}
          >
            <span className="nav-icon">
              {item === "Dashboard" ? "◫" : item === "Batches" ? "▤" : item === "Certificates" ? "▧" : item === "Verification" ? "✓" : "◷"}
            </span>
            {item}
            {item === "Dashboard" && user.role === "STATE" && stalledBatches.length > 0 && (
              <span className="nav-badge">{stalledBatches.length}</span>
            )}
          </button>
        ))}

        <div className="sidebar-bottom">
          <div className="profile">
            <div className="avatar profile-avatar">{user.name?.[0] || "U"}</div>
            <div className="profile-info">
              <strong>{user.name}</strong>
              <small>{roleLabels[user.role] || user.role}</small>
            </div>
          </div>
          <button className="logout-btn" onClick={logout}>↪ Sign out</button>
        </div>
      </aside>

      <main className="content">
        <div className="topbar">
          <div>
            <div className="breadcrumb">Workspace / {section}</div>
            <h1>{section}</h1>
            <p className="muted">Manage certification batches and approval workflows.</p>
          </div>
          <div className="top-actions">
            <div
              className={`live live-${apiStatus}`}
              role="status"
              aria-label={`API connection ${apiStatus}`}
              title={lastSync ? `Last updated ${lastSync.toLocaleTimeString()}` : "Waiting for API"}
            >
              <span className="live-dot" />
              <span>{apiStatus === "live" ? "LIVE" : apiStatus === "offline" ? "OFFLINE" : "CONNECTING"}</span>
              {lastSync && (
                <time className="live-time">
                  Updated {lastSync.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                </time>
              )}
            </div>
            <button className="secondary" onClick={() => refresh()} disabled={loading}>
              {loading ? "Refreshing..." : "↻ Refresh"}
            </button>
          </div>
        </div>

        {msg && (
          <div className="notice">
            <span>{msg}</span>
            <button className="notice-close" onClick={() => setMsg("")}>×</button>
          </div>
        )}

        {section === "Dashboard" && (
          <>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-top"><span>Total batches</span><span className="stat-icon">▤</span></div>
                <h2>{total}</h2>
                <small>All batches in workspace</small>
              </div>
              <div className="stat-card">
                <div className="stat-top"><span>In workflow</span><span className="stat-icon orange">◷</span></div>
                <h2>{pending}</h2>
                <small>Awaiting processing</small>
              </div>
              <div className="stat-card">
                <div className="stat-top"><span>Approved</span><span className="stat-icon green">✓</span></div>
                <h2>{approved}</h2>
                <small>Approved / issued</small>
              </div>
              <div className="stat-card">
                <div className="stat-top"><span>Returned</span><span className="stat-icon red">↩</span></div>
                <h2>{returned}</h2>
                <small>Requires corrections</small>
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <div><h2>Certification workflow</h2><p className="muted">Track the approval stages</p></div>
              </div>
              <div className="workflow">
                {["Centre", "District", "Quality", "State", "Certificate"].map((step, i) => (
                  <div className="workflow-step" key={step}>
                    <div className="workflow-circle">{i + 1}</div>
                    <strong>{step}</strong>
                    {i < 4 && <div className="workflow-line" />}
                  </div>
                ))}
              </div>
            </div>

            {user.role === "STATE" && (
              <div className="panel stalled-panel">
                <div className="panel-head">
                  <div>
                    <h2>Stalled batches</h2>
                    <p className="muted">Items waiting at an approval stage for more than 48 hours.</p>
                  </div>
                  <span className={`stall-count ${stalledBatches.length ? "has-stalled" : ""}`}>
                    {stalledBatches.length} overdue
                  </span>
                </div>
                {stalledBatches.length ? (
                  <div className="stalled-list">
                    {stalledBatches.map(batch => (
                      <div className="stalled-item" key={batch.id}>
                        <div>
                          <strong>{batch.name}</strong>
                          <small>{prettyStatus(batch.status)} · {batch.size} candidates</small>
                        </div>
                        <time dateTime={batch.updatedAt}>
                          Last activity {new Date(batch.updatedAt).toLocaleString()}
                        </time>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="stalled-clear">All batches are within the 48-hour review window.</p>
                )}
              </div>
            )}
          </>
        )}

        {section === "Dashboard" && user.role === "CENTRE" && (
          <div className="panel">
            <div className="panel-head">
              <div><h2>Create a batch</h2><p className="muted">Upload candidate CSV or create a demo batch.</p></div>
            </div>
            <div className="create-grid">
              <div className="field">
                <label>Batch name</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Batch name" />
              </div>
              <div className="field">
                <label>Candidate CSV</label>
                <input type="file" accept=".csv" onChange={e => setCsv(e.target.files?.[0] || null)} />
              </div>
              <button disabled={busy} onClick={importCsv}>{busy ? "Processing..." : "↑ Import CSV"}</button>
            </div>
            <div className="or-line"><span>OR</span></div>
            <button className="secondary" disabled={busy} onClick={() => act("/batches", {
              name,
              candidates: [
                { name: "Asha Rao", email: "asha" + Date.now() + "@example.com", course: "Frontend", score: 88 },
                { name: "Ravi Kumar", email: "ravi" + Date.now() + "@example.com", course: "Python", score: 92 }
              ]
            })}>＋ Create sample batch</button>
          </div>
        )}

        {(section === "Dashboard" || section === "Batches") && (
          <div className="panel">
            <div className="panel-head batch-panel-head">
              <div><h2>Batch registry</h2><p className="muted">Review and manage certification batches.</p></div>
              <span className="record-count">{filtered.length} records</span>
            </div>

            <div className="filters">
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="⌕ Search batches..." />
              <select value={filter} onChange={e => setFilter(e.target.value)}>
                <option value="ALL">All statuses</option>
                {Array.from(new Set(batches.map(b => b.status))).map(s => <option key={s} value={s}>{prettyStatus(s)}</option>)}
              </select>
            </div>

            {filtered.length === 0 ? <div className="empty"><span>▤</span><h3>No batches found</h3><p>Try changing your search or filters.</p></div> :
              <div className="batch-list">
                {filtered.map(b => (
                  <article className="batch-card" key={b.id}>
                    <div className="batch-main">
                      <div className="batch-title-row">
                        <h3>{b.name || "Untitled Batch"}</h3>
                        <span className={"status status-" + (b.status || "").toLowerCase()}>{prettyStatus(b.status)}</span>
                      </div>
                      <div className="batch-meta">
                        <span>♙ {b.size ?? b.candidates?.length ?? 0} candidates</span>
                        <span>▦ {b.id}</span>
                      </div>
                      <div className="batch-actions">
                        <button className="secondary small" onClick={() => setSelected(selected === b.id ? "" : b.id)}>
                          {selected === b.id ? "Hide details" : "View details"}
                        </button>

                        {user.role === "CENTRE" && (b.status === "DRAFT" || b.status === "RETURNED") &&
                          <button disabled={busy} className="small" onClick={() => act(`/batches/${b.id}/submit`)}>Submit batch</button>}

                        {user.role === "DISTRICT" && ["SUBMITTED", "DISTRICT_REVIEW"].includes(b.status) &&
                          <>
                            <button disabled={busy} className="small" onClick={() => act(`/batches/${b.id}/district-vote`, { decision: "approve" })}>✓ Approve</button>
                            <button disabled={busy} className="danger small" onClick={() => act(`/batches/${b.id}/district-vote`, { decision: "return", reason: "Please correct candidate data" })}>Return</button>
                          </>}

                        {user.role === "QUALITY" && b.status === "QUALITY_REVIEW" &&
                          <>
                            <button disabled={busy} className="small" onClick={() => act(`/batches/${b.id}/quality`, { decision: "approve" })}>✓ Quality approve</button>
                            <button disabled={busy} className="danger small" onClick={() => act(`/batches/${b.id}/quality`, { decision: "return" })}>Return</button>
                          </>}

                        {user.role === "STATE" && b.status === "STATE_REVIEW" &&
                          <>
                            <button disabled={busy} className="small" onClick={() => act(`/batches/${b.id}/state`, { decision: "approve" })}>✓ Issue certificates</button>
                            <button disabled={busy} className="danger small" onClick={() => act(`/batches/${b.id}/state`, { decision: "return" })}>Return</button>
                          </>}
                      </div>
                    </div>

                    {selected === b.id && (
                      <div className="batch-details">
                        <div className="detail-heading"><h4>Candidate records</h4><span>{b.candidates?.length || 0} listed</span></div>
                        {b.candidates?.length ? (
                          <div className="candidate-table">
                            {b.candidates.map((c: any) => (
                              <div className="candidate-row" key={c.id}>
                                <div><strong>{c.name}</strong><small>{c.email}</small></div>
                                <span>{c.course}</span>
                                <strong>{c.score}</strong>
                              </div>
                            ))}
                          </div>
                        ) : <p className="muted">Candidate records are not included in the batch list response.</p>}
                        <div className="detail-actions">
                          <button className="secondary small" onClick={() => loadAudit(b.id)}>View audit trail</button>
                          <button className="secondary small" onClick={() => setAudit({ votes: b.votes })}>View votes</button>
                        </div>
                        {audit && <pre className="json-view">{JSON.stringify(audit, null, 2)}</pre>}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            }
          </div>
        )}

        {section === "Certificates" && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <h2>Certificates</h2>
                <p className="muted">Issued certificates and their current status.</p>
              </div>
              <button className="secondary" onClick={loadCertificates}>Refresh certificates</button>
            </div>

            {certificates.length === 0 ? (
              <div className="empty">
                <h3>No certificates issued yet</h3>
                <p>Certificates will appear here after State approval.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Certificate No.</th>
                      <th>Candidate</th>
                      <th>Course</th>
                      <th>Status</th>
                      <th>Issued Date</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {certificates.map((cert: any) => (
                      <tr key={cert.id}>
                        <td>{cert.number}</td>
                        <td>{cert.candidate?.name || "-"}</td>
                        <td>{cert.candidate?.course || "-"}</td>
                        <td>{cert.status}</td>
                        <td>
                          {cert.issuedAt
                            ? new Date(cert.issuedAt).toLocaleDateString()
                            : "-"}
                        </td>
                        <td>
                          <button className="secondary small" onClick={() => setPreviewCert(cert)}>
                            View
                          </button>
                          {user.role === "STATE" && cert.status === "VALID" && (
                            <button
                              className="danger small"
                              disabled={busy}
                              onClick={() => cancelCertificate(cert.id)}
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {section === "Verification" && (
          <div className="panel verification-panel">
            <div className="panel-head"><div><h2>Public verification</h2><p className="muted">Verify certificate authenticity using its token.</p></div><span className="verify-icon">✓</span></div>
            <div className="verify-form">
              <input value={verifyToken} onChange={e => setVerifyToken(e.target.value)} placeholder="Enter certificate verification token" />
              <button disabled={busy} onClick={verifyCertificate}>{busy ? "Checking..." : "Verify certificate"}</button>
            </div>
            {verifyResult && <div className={"verify-result " + (verifyResult.ok ? "verify-success" : "verify-error")}>
              <h3>{verifyResult.ok ? "✓ Verification response" : "⚠ Verification failed"}</h3>
              <pre>{JSON.stringify(verifyResult.data, null, 2)}</pre>
            </div>}
          </div>
        )}

        {section === "Audit" && (
          <div className="panel">
            <h2>Audit records</h2>
            <p className="muted">Select a batch from the registry and use View audit trail to inspect its history.</p>
            <button className="secondary" onClick={() => setSection("Batches")}>Open batch registry</button>
            {audit && <pre className="json-view">{JSON.stringify(audit, null, 2)}</pre>}
          </div>
        )}

        {previewCert && (
          <div
            className="certificate-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Certificate preview"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1000,
              background: "rgba(0,0,0,0.65)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "24px",
              overflowY: "auto",
            }}
          >
            <div
              className="certificate-preview"
              style={{
                width: "min(900px, 100%)",
                background: "#fff",
                color: "#172033",
                padding: "40px",
                border: "8px double #b68b35",
                borderRadius: "12px",
                textAlign: "center",
                boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
              }}
            >
              <div style={{ color: "#b68b35", fontSize: "14px", letterSpacing: "5px", fontWeight: 700 }}>
                CERTIFLOW
              </div>
              <h1 style={{ fontFamily: "Georgia, serif", margin: "16px 0", fontSize: "36px" }}>
                Certificate of Achievement
              </h1>
              <p style={{ color: "#596579" }}>This certificate is proudly presented to</p>
              <h2 style={{ fontFamily: "Georgia, serif", fontSize: "32px", margin: "18px 0" }}>
                {previewCert.candidate?.name || "Candidate"}
              </h2>
              <p style={{ color: "#596579" }}>for successfully completing</p>
              <h3 style={{ fontSize: "24px", margin: "12px 0" }}>
                {previewCert.candidate?.course || "Course"}
              </h3>
              <div style={{ margin: "28px auto", width: "80px", borderTop: "2px solid #b68b35" }} />
              <p><strong>Certificate Number:</strong> {previewCert.number}</p>
              <p><strong>Issued:</strong> {previewCert.issuedAt ? new Date(previewCert.issuedAt).toLocaleDateString() : "—"}</p>
              <p><strong>Status:</strong> {previewCert.status}</p>
              <p><strong>Verification token:</strong> {previewCert.token || "Unavailable"}</p>
              <div style={{ display: "flex", justifyContent: "center", gap: "12px", flexWrap: "wrap", marginTop: "28px" }}>
                <button className="secondary" onClick={() => window.print()}>Print / Save PDF</button>
                <button className="btn" onClick={() => setPreviewCert(null)}>Close</button>
              </div>
            </div>
          </div>
        )}

        <footer>
          <span><span className="live-dot" /> Connected to local demo</span>
          <span>CertiFlow · Demo environment · Synthetic data only</span>
        </footer>
      </main>
    </div>
  );
}
