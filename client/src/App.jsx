import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";
const materials = ["PLA", "PETG", "ABS", "TPU", "Resin"];
const ModelViewer = lazy(() => import("./ModelViewer.jsx"));

async function api(path, token, options = {}) {
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message ?? "The request could not be completed.");
  return result;
}

function AuthScreen({ onSignedIn }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api(`/auth/${mode}`, null, {
        method: "POST",
        body: JSON.stringify({ name, email, password })
      });
      onSignedIn(result);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <a className="brand auth-brand" href="/">
        <span className="brand-mark">K</span> KD PRINTS
      </a>
      <div className="auth-card">
        <div className="eyebrow">YOUR NEXT IDEA, MADE REAL</div>
        <h1>{mode === "login" ? "Welcome back." : "Make an account."}</h1>
        <p className="muted">
          {mode === "login"
            ? "Sign in to pick up where you left off."
            : "Create an account to start your first print."}
        </p>
        <form className="form-stack" onSubmit={submit}>
          {mode === "register" && (
            <label>
              Your name
              <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required maxLength={80} />
            </label>
          )}
          <label>
            Email address
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required />
            {mode === "register" && <span className="field-hint">At least 8 characters</span>}
          </label>
          {error && <div className="notice error">{error}</div>}
          <button className="button primary full-width" disabled={busy}>
            {busy ? "One moment…" : mode === "login" ? "Sign in" : "Create account"}
            {!busy && <span aria-hidden="true">↗</span>}
          </button>
        </form>
        <p className="auth-switch">
          {mode === "login" ? "New to KD Prints?" : "Already have an account?"}{" "}
          <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </div>
      <div className="auth-caption">DESIGNED FOR MAKERS · BUILT TO MAKE</div>
    </main>
  );
}

function formatSize(bytes) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(date) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(date));
}

function PrintabilityReport({ analysis, analyzedAt }) {
  if (!analysis) return null;

  return (
    <section className="analysis-report" aria-label="Printability report">
      <div className="analysis-report-heading">
        <div>
          <span className={`analysis-status analysis-${analysis.status}`}>
            {analysis.status === "pass" ? "CHECK COMPLETE" : analysis.status === "fail" ? "ACTION NEEDED" : "REVIEW"}
          </span>
          <p>{analysis.summary}</p>
        </div>
        <span className="analysis-time">{analyzedAt ? formatDate(analyzedAt) : ""}</span>
      </div>
      <div className="analysis-stats">
        <div><span>DIMENSIONS · MM</span><strong>{analysis.dimensions_mm.map((dimension) => Number(dimension).toFixed(1)).join(" × ")}</strong></div>
        <div><span>TRIANGLES</span><strong>{Number(analysis.triangle_count).toLocaleString()}</strong></div>
        <div><span>WATERTIGHT</span><strong>{analysis.is_watertight ? "Yes" : "No"}</strong></div>
      </div>
      {analysis.issues?.length > 0 && (
        <div className="analysis-issues">
          {analysis.issues.map((issue) => (
            <article className="analysis-issue" key={issue.code}>
              <span className={`issue-indicator issue-${issue.severity}`} />
              <div><strong>{issue.title}</strong><p>{issue.detail}</p></div>
            </article>
          ))}
        </div>
      )}
      <details className="analysis-limitations">
        <summary>What this check can and can’t tell you</summary>
        <ul>{analysis.limitations?.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
      </details>
    </section>
  );
}

function PrinterFleet({ token }) {
  const [printers, setPrinters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const result = await api("/admin/printers", token);
      setPrinters(result.printers);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    refresh();
    const intervalId = window.setInterval(refresh, 10000);
    return () => window.clearInterval(intervalId);
  }, [refresh]);

  return (
    <section className="fleet-section" id="printers">
      <div className="fleet-heading">
        <div className="section-heading">
          <div><span className="step-number">04</span><h2>Printer fleet</h2></div>
          <span className="fleet-live"><span className="live-dot" /> REFRESHES EVERY 10 SEC</span>
        </div>
        <button className="fleet-refresh" onClick={refresh} disabled={loading}>Refresh ↻</button>
      </div>
      {error && <div className="fleet-message error">{error}</div>}
      {!error && loading && <div className="fleet-message">Connecting to configured printers…</div>}
      {!error && !loading && printers.length === 0 && (
        <div className="fleet-message">No printers configured yet. Add OctoPrint printers to the server configuration to see them here.</div>
      )}
      {printers.length > 0 && (
        <div className="printer-grid">
          {printers.map((printer) => (
            <article className={`printer-card ${printer.online ? "printer-online" : "printer-offline"}`} key={printer.id}>
              <div className="printer-card-heading">
                <span className={`printer-light ${printer.online ? (printer.flags?.error ? "light-error" : "light-online") : ""}`} />
                <strong>{printer.name}</strong>
                <span className="printer-state">{printer.online ? printer.state : "OFFLINE"}</span>
              </div>
              {!printer.online ? (
                <p className="printer-error">{printer.error}</p>
              ) : (
                <>
                  {printer.job.name && (
                    <div className="printer-job">
                      <span>{printer.job.name}</span>
                      <span>{printer.job.completion === null ? "—" : `${printer.job.completion.toFixed(0)}%`}</span>
                    </div>
                  )}
                  {printer.job.name && printer.job.completion !== null && (
                    <div className="printer-progress"><span style={{ width: `${printer.job.completion}%` }} /></div>
                  )}
                  <div className="printer-temps">
                    {Object.entries(printer.temperatures).map(([name, reading]) => (
                      <span key={name}>{name.toUpperCase()} <strong>{reading.actual.toFixed(0)}°</strong>{reading.target ? ` / ${reading.target.toFixed(0)}°` : ""}</span>
                    ))}
                    {!Object.keys(printer.temperatures).length && <span>No temperature data</span>}
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function Dashboard({ token, user, onSignOut }) {
  const [models, setModels] = useState([]);
  const [orders, setOrders] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [material, setMaterial] = useState("PLA");
  const [quantity, setQuantity] = useState(1);
  const [color, setColor] = useState("Natural");
  const [postProcessing, setPostProcessing] = useState(false);
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [notice, setNotice] = useState({ kind: "", text: "" });
  const fileInputRef = useRef(null);
  const selectedModel = models.find((model) => (model._id ?? model.id) === selectedModelId) ?? null;

  const loadDashboard = useCallback(async () => {
    const [modelResult, orderResult] = await Promise.all([
      api("/models", token),
      api("/orders", token)
    ]);
    setModels(modelResult.models);
    setOrders(orderResult.orders);
    setSelectedModelId((current) => current || modelResult.models[0]?._id || modelResult.models[0]?.id || "");
  }, [token]);

  useEffect(() => {
    loadDashboard().catch((error) => setNotice({ kind: "error", text: error.message }));
  }, [loadDashboard]);

  async function uploadModel(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setNotice({ kind: "", text: "" });
    try {
      const form = new FormData();
      form.append("model", file);
      const result = await api("/models", token, { method: "POST", body: form });
      const model = result.model;
      setModels((current) => [model, ...current]);
      setSelectedModelId(model.id);
      setNotice({ kind: "success", text: "Model uploaded and ready to preview." });
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    } finally {
      setUploading(false);
    }
  }

  async function placeOrder(event) {
    event.preventDefault();
    if (!selectedModel) {
      setNotice({ kind: "error", text: "Upload a model before placing an order." });
      return;
    }
    setPlacingOrder(true);
    setNotice({ kind: "", text: "" });
    try {
      await api("/orders", token, {
        method: "POST",
        body: JSON.stringify({
          modelId: selectedModel._id ?? selectedModel.id,
          material,
          color,
          quantity: Number(quantity),
          postProcessing,
          notes
        })
      });
      await loadDashboard();
      setNotes("");
      setNotice({ kind: "success", text: "Order placed. Our team will review your model and follow up." });
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    } finally {
      setPlacingOrder(false);
    }
  }

  async function analyzeModel() {
    if (!selectedModel) return;
    setAnalyzing(true);
    setNotice({ kind: "", text: "" });
    try {
      await api(`/models/${selectedModel._id ?? selectedModel.id}/analyze`, token, {
        method: "POST"
      });
      await loadDashboard();
      setNotice({ kind: "success", text: "Printability check complete. Review the report before requesting a print." });
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    } finally {
      setAnalyzing(false);
    }
  }

  async function cancelOrder(orderId) {
    try {
      await api(`/orders/${orderId}/cancel`, token, { method: "PATCH" });
      await loadDashboard();
      setNotice({ kind: "success", text: "Order cancelled." });
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">K</span><span>KD PRINTS</span>
        </a>
        <nav className="topnav" aria-label="Main navigation">
          <a className="nav-active" href="#new-print">New print</a>
          <a href="#orders">My orders <span className="nav-count">{orders.length}</span></a>
          {user.isAdmin && <a href="#printers">Printers</a>}
        </nav>
        <div className="account">
          <span className="account-avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <span className="account-name">{user.name}</span>
          <button className="sign-out" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      <main className="main-content">
        <section className="welcome-row">
          <div>
            <div className="eyebrow">YOUR MAKER WORKSPACE <span className="eyebrow-line" /></div>
            <h1>Good to see you, {user.name.split(" ")[0]}<span className="period">.</span></h1>
            <p>From a file on your screen to something you can hold.</p>
          </div>
          <div className="welcome-note"><span className="status-indicator" /> PRINT STUDIO <span>·</span> LATakia</div>
        </section>

        {notice.text && <div className={`notice ${notice.kind}`} role="status"><span>{notice.kind === "error" ? "!" : "✓"}</span>{notice.text}<button aria-label="Dismiss message" onClick={() => setNotice({ kind: "", text: "" })}>×</button></div>}

        <section className="workspace-grid" id="new-print">
          <div className="left-column">
            <div className="section-heading">
              <div><span className="step-number">01</span><h2>Your model</h2></div>
              <span className="file-limit">STL / OBJ · UP TO 25 MB</span>
            </div>
            <div className="upload-bar">
              <div className="upload-copy"><span className="upload-icon">↑</span><span><strong>{uploading ? "Uploading model…" : "Start with your 3D file"}</strong><small>Drop a design into your workspace</small></span></div>
              <button className="button dark-button" onClick={() => fileInputRef.current?.click()} disabled={uploading}>{uploading ? "Uploading…" : "Choose file"} <span>↗</span></button>
              <input ref={fileInputRef} className="visually-hidden" type="file" accept=".stl,.obj,model/stl,text/plain" onChange={uploadModel} />
            </div>
            {models.length > 0 && (
              <label className="model-select-label">
                Current model
                <select value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value)}>
                  {models.map((model) => <option key={model._id ?? model.id} value={model._id ?? model.id}>{model.originalName}</option>)}
                </select>
              </label>
            )}
            {selectedModel ? (
              <Suspense fallback={<div className="viewer"><div className="viewer-grid" aria-hidden="true" /><div className="viewer-state">Loading 3D viewer…</div></div>}>
                <ModelViewer model={selectedModel} token={token} apiUrl={API_URL} />
              </Suspense>
            ) : (
              <div className="viewer">
                <div className="viewer-grid" aria-hidden="true" />
                <div className="viewer-empty"><span className="cube-icon">◇</span><span>Your model appears here</span></div>
              </div>
            )}
            {selectedModel && <div className="model-meta"><span className="file-chip">{selectedModel.format.toUpperCase()}</span><span>{selectedModel.originalName}</span><span className="meta-size">{formatSize(selectedModel.size)}</span></div>}
            {selectedModel && (
              <button className="button analysis-button" onClick={analyzeModel} disabled={analyzing}>
                <span>{analyzing ? "Checking geometry…" : selectedModel.analysis ? "Run printability check again" : "Check printability"}</span>
                <span>{analyzing ? "…" : "↗"}</span>
              </button>
            )}
            {selectedModel?.analysis && <PrintabilityReport analysis={selectedModel.analysis} analyzedAt={selectedModel.analyzedAt} />}
            <div className="preview-footnote"><span>✳</span> Drag to rotate <i>·</i> Scroll to zoom <i>·</i> Preview stays private to your account</div>
          </div>

          <aside className="order-panel">
            <div className="section-heading order-heading"><div><span className="step-number">02</span><h2>Make it yours</h2></div><span className="sparkle">✳</span></div>
            <p className="panel-intro">Choose a material and tell us a little about your print.</p>
            <form className="order-form" onSubmit={placeOrder}>
              <label>Material
                <select value={material} onChange={(event) => setMaterial(event.target.value)}>
                  {materials.map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
              <div className="field-row">
                <label>Color
                  <input value={color} onChange={(event) => setColor(event.target.value)} maxLength={40} placeholder="Natural" />
                </label>
                <label>Quantity
                  <input type="number" min="1" max="100" value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
                </label>
              </div>
              <label className="check-row"><input type="checkbox" checked={postProcessing} onChange={(event) => setPostProcessing(event.target.checked)} /><span>Include post-processing</span><span className="optional">OPTIONAL</span></label>
              <label>Anything we should know?
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} rows={3} placeholder="Intended use, dimensions, or a special request…" />
              </label>
              <div className="quote-note"><span>↗</span><span>Our team will review your model and confirm the quote before printing.</span></div>
              <button className="button primary order-submit" disabled={placingOrder || !selectedModel}>
                {placingOrder ? "Sending your request…" : "Request a print"} <span>↗</span>
              </button>
              {!selectedModel && <div className="submit-hint">Upload a model to request a print</div>}
            </form>
          </aside>
        </section>

        {user.isAdmin && <PrinterFleet token={token} />}

        <section className="orders-section" id="orders">
          <div className="orders-title"><div className="section-heading"><div><span className="step-number">03</span><h2>Your orders</h2></div></div><span className="order-total">{orders.length} {orders.length === 1 ? "ORDER" : "ORDERS"}</span></div>
          {orders.length === 0 ? (
            <div className="empty-orders"><span>◷</span><div><strong>Nothing in the queue yet.</strong><p>Your print requests will show up here.</p></div></div>
          ) : (
            <div className="order-list">
              {orders.map((order) => (
                <article className="order-row" key={order._id}>
                  <div className="order-file-icon">▧</div>
                  <div className="order-file"><strong>{order.model?.originalName ?? "3D model"}</strong><span>{order.material} <i>·</i> Qty {order.quantity} <i>·</i> {formatDate(order.createdAt)}</span></div>
                  <span className={`order-status status-${order.status}`}>{order.status.replace("_", " ")}</span>
                  {order.status === "pending" && <button className="cancel-order" onClick={() => cancelOrder(order._id)}>Cancel</button>}
                </article>
              ))}
            </div>
          )}
        </section>
        <footer className="page-footer"><span>GOOD IDEAS DESERVE TO BE MADE.</span><span>KD PRINTS <i>·</i> LATAKIA, SYRIA</span></footer>
      </main>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("kdprints-token"));
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(Boolean(token));

  useEffect(() => {
    if (!token) {
      setCheckingSession(false);
      return;
    }
    let active = true;
    api("/auth/me", token)
      .then(({ user: currentUser }) => { if (active) setUser(currentUser); })
      .catch(() => {
        if (active) {
          localStorage.removeItem("kdprints-token");
          setToken(null);
          setUser(null);
        }
      })
      .finally(() => { if (active) setCheckingSession(false); });
    return () => { active = false; };
  }, [token]);

  function signIn(result) {
    localStorage.setItem("kdprints-token", result.token);
    setUser(result.user);
    setToken(result.token);
  }

  function signOut() {
    localStorage.removeItem("kdprints-token");
    setToken(null);
    setUser(null);
  }

  if (checkingSession) return <div className="loading-screen">KD PRINTS <span>·</span> Opening your workspace…</div>;
  if (!user || !token) return <AuthScreen onSignedIn={signIn} />;
  return <Dashboard token={token} user={user} onSignOut={signOut} />;
}
