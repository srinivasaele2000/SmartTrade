import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReviewRequests from "./ReviewRequests";
import Catalogue from "./Catalogue";
import Dealers from "./Dealers";
import { ApiError, apiResponse, ensureList, onSessionExpired, requestApi } from "./api";
import { pages, pageFromHash } from "./navigation";

import { developmentAvailable, developmentOtpAvailable, otpAcknowledgementMessage, loadStaffSession } from './auth';
import type { StaffAccount as Account, LoginResponse, OtpAcknowledgement } from './auth';
type DocumentItem = {
  id: number;
  document_type: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
};
type Company = {
  id: number;
  legal_name: string;
  trading_name: string;
  registration_number: string;
  tax_registration_number: string;
  authorized_person_name: string;
  company_email: string;
  email_verified_at: string | null;
  address_line: string;
  pin_code: string;
  area: string;
  district: string;
  state_or_region: string;
  website: string;
  verification_state: string;
  activity_state: string;
  created_at: string;
};
type VerificationCase = {
  email_verification_mode?: "provider_verified" | "development_simulated" | "unverified";
  id: number;
  company_id: number;
  legal_name: string;
  company_email: string;
  status: string;
  submitted_at: string;
  assigned_reviewer_account_id: number | null;
  document_types: string[];
  company: Company;
  documents: DocumentItem[];
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(/\/+$/, "");

const apiRequest = <T,>(path: string, token?: string, init: RequestInit = {}) => requestApi<T>(API_BASE, path, token, init);

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function App() {
  const [page, setPage] = useState(() => pageFromHash(window.location.hash));
  const currentPage = pages.find(item => item.id === page)!;
  const [sessionMessage, setSessionMessage] = useState("");
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [otpRequested, setOtpRequested] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [devAuthEnabled, setDevAuthEnabled] = useState(false);
  const [devOtpEnabled, setDevOtpEnabled] = useState(false);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [refreshDelay, setRefreshDelay] = useState(240_000);

  const [loginMessage, setLoginMessage] = useState("");
  const [apiStatus, setApiStatus] = useState<"checking" | "connected" | "unavailable">("checking");
  const [healthAttempt, setHealthAttempt] = useState(0);
  const queueLoadId = useRef(0);
  const [cases, setCases] = useState<VerificationCase[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [queueState, setQueueState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [queueError, setQueueError] = useState("");
  const [actionMessage, setActionMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [documentBusy, setDocumentBusy] = useState<number | null>(null);
  const [decision, setDecision] = useState<"APPROVE" | "REJECT" | null>(null);
  const [reason, setReason] = useState("");
  const [decisionBusy, setDecisionBusy] = useState(false);

  const selectedCase = useMemo(() => cases.find((item) => item.company_id === selectedId) ?? null, [cases, selectedId]);

  useEffect(() => {
    const navigate = () => { setPage(pageFromHash(window.location.hash)); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);

  useEffect(() => onSessionExpired(token => {
    if (token !== accessToken) return;
    setAccessToken(null); setRefreshToken(null); setAccount(null); setCases([]); setSelectedId(null);
    setSessionMessage('Your staff session expired or was revoked. Sign in again.');
  }), [accessToken]);

  useEffect(() => {
    let cancelled = false;
    setApiStatus('checking');
    apiRequest<{ status: string }>("/health")
      .then(() => { if (!cancelled) setApiStatus("connected"); })
      .catch(() => { if (!cancelled) setApiStatus("unavailable"); });
    return () => { cancelled = true; };
  }, [healthAttempt]);

  useEffect(() => {
    let cancelled = false;
    developmentAvailable(API_BASE, import.meta.env.DEV, window.location.hostname)
      .then(value => { if (!cancelled) setDevAuthEnabled(value); })
      .catch(() => { if (!cancelled) setDevAuthEnabled(false); });
    developmentOtpAvailable(API_BASE, import.meta.env.DEV, window.location.hostname)
      .then(value => { if (!cancelled) setDevOtpEnabled(value); });
    return () => { cancelled = true; };
  }, [healthAttempt]);

  useEffect(() => {
    if (!refreshToken || !accessToken) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const payload = await apiRequest<{ access: string; refresh?: string }>("/auth/refresh", undefined, {
          method: "POST", body: JSON.stringify({ refresh: refreshToken }),
        });
        if (!cancelled) {
          if (!payload.access) throw new Error('Refresh returned no access token.');
          setAccessToken(payload.access);
          if (payload.refresh) setRefreshToken(payload.refresh);
        }
      } catch {
        if (!cancelled) {
          setAccessToken(null); setRefreshToken(null); setAccount(null);
          setSessionMessage('Session refresh failed. Sign in again.');
        }
      }
    }, refreshDelay);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [accessToken, refreshToken, refreshDelay]);

  async function acceptLogin(payload: LoginResponse) {
    const session = await loadStaffSession(API_BASE, payload);
    setAccount(session.account); setAccessToken(session.access); setRefreshToken(session.refresh);
    setRefreshDelay(session.refreshDelay);
    setSessionMessage(''); setOtp('');
  }

  async function developmentLogin() {
    if (!import.meta.env.DEV) return;
    setLoginBusy(true); setLoginMessage('');
    try {
      await acceptLogin(await apiRequest<LoginResponse>("/auth/dev-login", undefined, { method: 'POST', body: '{}' }));
    } catch (error) {
      setLoginMessage(error instanceof ApiError && error.status === 404 ? 'Development authentication is disabled or this request is not local.' : error instanceof Error ? error.message : 'Development login failed.');
    } finally { setLoginBusy(false); }
  }

  const loadQueue = useCallback(async (token: string) => {
    const id = ++queueLoadId.current;
    setQueueState("loading");
    setQueueError("");
    try {
      const payload = await apiRequest<{ results: VerificationCase[] }>("/staff/companies/verification-queue", token);
      ensureList(payload);
      if (id !== queueLoadId.current) return;
      setCases(payload.results);
      setSelectedId((current) => current && payload.results.some((item) => item.company_id === current) ? current : null);
      setQueueState("ready");
    } catch (error) {
      if (id !== queueLoadId.current) return;
      setQueueError(error instanceof Error ? error.message : "Could not load the verification queue.");
      setQueueState("error");
    }
  }, []);

  useEffect(() => {
    if (accessToken && page === 'verification') void loadQueue(accessToken);
    return () => { queueLoadId.current++; };
  }, [accessToken, loadQueue, page]);

  async function requestOtp(event: FormEvent) {
    event.preventDefault();
    setLoginBusy(true);
    setLoginMessage("");
    try {
      const response = await apiRequest<OtpAcknowledgement>("/auth/otp/request", undefined, {
        method: "POST", body: JSON.stringify({ mobile_e164: mobile.trim() }),
      });
      setOtpRequested(true);
      setLoginMessage(otpAcknowledgementMessage(response));
    } catch (error) {
      setLoginMessage(error instanceof Error ? error.message : "Could not request a verification code.");
    } finally {
      setLoginBusy(false);
    }
  }

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setLoginBusy(true);
    setLoginMessage("");
    try {
      const payload = await apiRequest<LoginResponse>("/auth/login", undefined, {
        method: "POST", body: JSON.stringify({ mobile_e164: mobile.trim(), code: otp.trim() }),
      });
      await acceptLogin(payload);
    } catch (error) {
      setLoginMessage(error instanceof Error ? error.message : "Staff sign-in failed.");
    } finally {
      setLoginBusy(false);
    }
  }

  async function signOut() {
    const token = accessToken;
    setAccessToken(null);
    setRefreshToken(null);
    setAccount(null);
    setCases([]);
    setSelectedId(null);
    setActionMessage(null); setOtp(""); setOtpRequested(false); setSessionMessage("");
    if (token) {
      try { await apiRequest<void>("/auth/logout", token, { method: "POST" }); }
      catch { setSessionMessage('Browser credentials were cleared, but server logout could not be confirmed. Existing server tokens may remain valid until expiry or revocation.'); }
    }
  }

  async function claimReview(item: VerificationCase) {
    if (!accessToken) return;
    setClaimBusy(true);
    setActionMessage(null);
    try {
      await apiRequest(`/staff/companies/${item.company_id}/claim`, accessToken, { method: "POST", body: JSON.stringify({}) });
      setActionMessage({ kind: "success", text: `Review claimed for ${item.legal_name}.` });
      await loadQueue(accessToken);
      setSelectedId(item.company_id);
    } catch (error) {
      setActionMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not claim this review." });
    } finally {
      setClaimBusy(false);
    }
  }

  async function downloadDocument(item: VerificationCase, documentItem: DocumentItem) {
    if (!accessToken || !API_BASE) return;
    setDocumentBusy(documentItem.id);
    setActionMessage(null);
    try {
      const response = await apiResponse(API_BASE, `/staff/companies/${item.company_id}/documents/${documentItem.id}`, accessToken);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = documentItem.original_filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setActionMessage({ kind: "success", text: `Downloaded ${documentItem.document_type}.` });
    } catch (error) {
      const message = error instanceof ApiError && error.status === 403
        ? "Your staff role cannot view this private document, or this case is not assigned to you."
        : error instanceof Error ? error.message : "Could not access this private document.";
      setActionMessage({ kind: "error", text: message });
    } finally {
      setDocumentBusy(null);
    }
  }

  async function submitDecision(event: FormEvent) {
    event.preventDefault();
    if (!accessToken || !selectedCase || !decision || !reason.trim()) return;
    setDecisionBusy(true);
    setActionMessage(null);
    try {
      await apiRequest(`/staff/companies/${selectedCase.company_id}/verification-decision`, accessToken, {
        method: "POST", body: JSON.stringify({ decision, reason: reason.trim() }),
      });
      setActionMessage({ kind: "success", text: `${selectedCase.legal_name} was ${decision === "APPROVE" ? "approved" : "rejected"}.` });
      setDecision(null);
      setReason("");
      await loadQueue(accessToken);
    } catch (error) {
      setActionMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not save the review decision." });
    } finally {
      setDecisionBusy(false);
    }
  }

  const apiConfigured = Boolean(API_BASE);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-mark">ST</div>
        <div className="brand-name">SmartTrade</div>
        <div className="brand-caption">ADMIN CONSOLE</div>
        <nav aria-label="Admin navigation">
          {pages.map(item => <a key={item.id} href={`#${item.id}`} className={page === item.id ? 'active' : undefined} aria-current={page === item.id ? 'page' : undefined}>{item.label}</a>)}
        </nav>
        <p className="sidebar-note">Staff permissions are enforced by the API. Private documents are never served from public URLs.</p>
      </aside>

      <main className="main-content" id="page-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">SMARTTRADE / ADMIN</p>
            <h1>{currentPage.title}</h1>
          </div>
          <div className="topbar-actions">
            <span className={`connection-badge ${apiStatus}`} role="status">API {apiStatus === "checking" ? "checking…" : apiStatus}</span>
            {apiStatus === 'unavailable' && <button className="button button-quiet" onClick={() => setHealthAttempt(value => value + 1)}>Retry API connection</button>}
            {account && <span className="environment-badge" title={`Roles: ${account.staff_profile?.roles.join(', ') || 'none'}; permissions: ${account.staff_profile?.permissions.join(', ') || 'none'}`}>STAFF ACCOUNT {account.id}</span>}
            {accessToken && <button className="button button-quiet" onClick={() => void signOut()}>Sign out</button>}
          </div>
        </header>

        <section className="welcome-panel" aria-labelledby="welcome-title">
          <div>
            <p className="eyebrow">RELEASE 1</p>
            <h2 id="welcome-title">{currentPage.label}</h2>
            <p>{currentPage.description}</p>
          </div>
          <div className="welcome-symbol" aria-hidden="true">ST</div>
        </section>

        {sessionMessage && <p className="action-message error" role="status">{sessionMessage}</p>}
        {page === 'overview' ? <section id="overview" className="queue-section"><h2>Administration workflows</h2><p>The API badge reports process health only. Staff access and permissions are checked separately; it does not indicate OTP configuration or database readiness.</p><div className="cards">{pages.filter(item => item.id !== 'overview').map(item => <a className="queue-card" key={item.id} href={`#${item.id}`}><strong>{item.label}</strong><span>{item.id === 'audit' ? 'History viewer not implemented' : accessToken ? 'Open workflow · backend permissions apply' : 'Staff sign-in required'}</span></a>)}</div></section> : page === 'audit' ? <section id="audit" className="state-panel"><h2>Audit history viewer is not implemented</h2><p>The combined audit viewer is not implemented. Catalogue history is available in Catalogue, and authorization history in Dealer network, to staff with READ_AUDIT permission. This page does not display audit records.</p></section> : !apiConfigured ? (
          <section className="state-panel error-panel" aria-live="polite">
            <h2>API configuration required</h2>
            <p>Set <code>VITE_API_BASE_URL</code> in the admin environment to the API base path, such as the local development API. Restart the Vite server after changing it.</p>
          </section>
        ) : !accessToken ? (
          <section className="auth-panel" aria-labelledby="signin-title">
            <div>
              <p className="eyebrow">STAFF ACCESS</p>
              <h2 id="signin-title">Sign in to access {currentPage.label}</h2>
              <p>Use an existing staff account and the configured OTP provider. This screen does not create staff accounts or bypass API permissions.</p>
              {import.meta.env.DEV && devOtpEnabled ? <p role="status">LOCAL DEVELOPMENT OTP: no SMS is sent. Any non-empty code is accepted only for the configured development environment. Admin access still requires the designated active STAFF account and enabled development authentication.</p> : <p>Without a configured provider or explicitly enabled local development OTP mode, requests return AUTH_PROVIDER_UNAVAILABLE.</p>}
            </div>
            <div>
            {import.meta.env.DEV && devAuthEnabled && <div className="state-panel"><h3>Local development authentication</h3><p>Uses only the server-designated existing staff account. No phone verification or permissions are granted.</p><button className="button button-quiet" type="button" disabled={loginBusy} onClick={() => void developmentLogin()}>Development Login</button></div>}
            <form className="signin-form" onSubmit={otpRequested ? signIn : requestOtp}>
              <label htmlFor="staff-mobile">Staff mobile number (E.164)</label>
              <input id="staff-mobile" type="tel" autoComplete="tel" pattern="[+][1-9][0-9]{1,14}" maxLength={16} title="Use a complete E.164 number: + followed by country code and number, without spaces." placeholder="+<country code><number>" value={mobile} onChange={(event) => setMobile(event.target.value)} required />
              {otpRequested && <>
                <label htmlFor="staff-otp">Verification code</label>
                <input id="staff-otp" autoComplete="one-time-code" value={otp} onChange={(event) => setOtp(event.target.value)} required />
              </>}
              <button className="button button-primary" disabled={loginBusy} type="submit">
                {loginBusy ? "Please wait…" : otpRequested ? "Verify and sign in" : "Send OTP"}
              </button>
              {otpRequested && <button className="text-button" type="button" disabled={loginBusy} onClick={() => { setOtpRequested(false); setOtp(""); setLoginMessage(""); }}>Use a different number</button>}
              {loginMessage && <p className="inline-message" role="status">{loginMessage}</p>}
            </form>
            </div>
          </section>
        ) : page === 'verification' ? (
          <section id="verification" className="verification-layout" aria-labelledby="queue-title">
            <div className="queue-column">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">WORK QUEUE</p>
                  <h2 id="queue-title">Company reviews</h2>
                </div>
                <button className="button button-quiet" disabled={claimBusy || decisionBusy} onClick={() => void loadQueue(accessToken)}>Refresh</button>
              </div>
              {queueState === "loading" && <div className="state-panel"><span className="spinner" />Loading company reviews…</div>}
              {queueState === "error" && <div className="state-panel error-panel" role="alert"><h3>Verification queue unavailable</h3><p>{queueError}</p><button className="button button-quiet" onClick={() => void loadQueue(accessToken)}>Try again</button></div>}
              {queueState === "ready" && cases.length === 0 && <div className="state-panel"><h3>No pending company reviews</h3><p>The API returned an empty verification queue.</p></div>}
              {queueState === "ready" && cases.length > 0 && <div className="case-list">
                {cases.map((item) => <button className={`case-row${selectedId === item.company_id ? " selected" : ""}`} disabled={claimBusy || decisionBusy} key={item.id} onClick={() => { setSelectedId(item.company_id); setActionMessage(null); setDecision(null); }}>
                  <span className="case-row-main"><strong>{item.legal_name}</strong><span>{item.company_email}</span><small>Submitted {formatDate(item.submitted_at)}</small></span>
                  <span className="case-row-meta"><span className="status-pill">{item.status}</span><small>{item.documents.length} document{item.documents.length === 1 ? "" : "s"}</small></span>
                </button>)}
              </div>}
            </div>

            <div className="review-column">
              {!selectedCase ? <div className="state-panel detail-placeholder"><h3>Select a company review</h3><p>Company registration details and the assigned review actions will appear here.</p></div> : <>
                <div className="detail-heading">
                  <div><p className="eyebrow">COMPANY {selectedCase.company.id}</p><h2>{selectedCase.company.legal_name}</h2></div>
                  <span className="status-pill">{selectedCase.company.verification_state}</span>
                </div>
                <div className="detail-card">
                  <h3>Registration details</h3>
                  <dl className="detail-grid">
                    <dt>Trading name</dt><dd>{selectedCase.company.trading_name || "Not provided"}</dd>
                    <dt>Registration number</dt><dd>{selectedCase.company.registration_number || "Not provided"}</dd>
                    <dt>Tax registration</dt><dd>{selectedCase.company.tax_registration_number || "Not provided"}</dd>
                    <dt>Authorized person</dt><dd>{selectedCase.company.authorized_person_name || "Not provided"}</dd>
                    <dt>Company email</dt><dd>{selectedCase.company.company_email}</dd>
                    <dt>Email verified</dt><dd>{selectedCase.company.email_verified_at ? formatDate(selectedCase.company.email_verified_at) : selectedCase.email_verification_mode === "development_simulated" ? "Local simulation only; ownership unverified" : "Not verified"}</dd>
                    <dt>Address</dt><dd>{[selectedCase.company.address_line, selectedCase.company.area, selectedCase.company.district, selectedCase.company.pin_code, selectedCase.company.state_or_region].filter(Boolean).join(", ") || "Not provided"}</dd>
                    <dt>Website</dt><dd>{selectedCase.company.website ? <a href={selectedCase.company.website} target="_blank" rel="noreferrer">{selectedCase.company.website}</a> : "Not provided"}</dd>
                    <dt>Activity</dt><dd>{selectedCase.company.activity_state}</dd>
                  </dl>
                </div>
                <div className="detail-card">
                  <div className="section-heading compact-heading"><div><h3>Verification documents</h3><p>Files are fetched only through the authorized staff endpoint.</p></div></div>
                  {selectedCase.documents.length === 0 ? <p className="muted">No document metadata was returned for this case.</p> : <ul className="document-list">
                    {selectedCase.documents.map((item) => <li key={item.id}><span><strong>{item.document_type}</strong><small>{item.original_filename} · {(item.size_bytes / 1024).toFixed(0)} KB</small></span><button className="button button-quiet" disabled={documentBusy === item.id || selectedCase.assigned_reviewer_account_id !== account?.id} onClick={() => void downloadDocument(selectedCase, item)}>{documentBusy === item.id ? "Loading…" : "Download securely"}</button></li>)}
                  </ul>}
                  <p className="permission-hint">Document downloads require this case to be assigned to you and the <code>VIEW_PRIVATE_DOCUMENTS</code> staff permission.</p>
                </div>
                <div className="detail-card review-actions">
                  <div className="section-heading compact-heading"><div><h3>Review decision</h3><p>Approval or rejection requires a recorded reason.</p></div></div>
                  {selectedCase.assigned_reviewer_account_id === account?.id ? <>
                    {!decision ? <div className="decision-buttons"><button className="button button-primary" onClick={() => setDecision("APPROVE")}>Approve company</button><button className="button button-danger" onClick={() => setDecision("REJECT")}>Reject company</button></div> : <form onSubmit={(event) => void submitDecision(event)}>
                      <label htmlFor="decision-reason">Reason for {decision === "APPROVE" ? "approval" : "rejection"}</label>
                      <textarea id="decision-reason" rows={4} maxLength={4000} disabled={decisionBusy} value={reason} onChange={(event) => setReason(event.target.value)} required />
                      <div className="decision-buttons"><button className={`button ${decision === "APPROVE" ? "button-primary" : "button-danger"}`} disabled={decisionBusy || !reason.trim()} type="submit">{decisionBusy ? "Saving…" : `Confirm ${decision.toLowerCase()}`}</button><button className="button button-quiet" type="button" disabled={decisionBusy} onClick={() => { setDecision(null); setReason(""); }}>Cancel</button></div>
                    </form>}
                  </> : <button className="button button-primary" disabled={claimBusy || Boolean(selectedCase.assigned_reviewer_account_id)} onClick={() => void claimReview(selectedCase)}>{claimBusy ? "Claiming…" : selectedCase.assigned_reviewer_account_id ? `Assigned to staff account ${selectedCase.assigned_reviewer_account_id}` : "Claim review"}</button>}
                </div>
              </>}
            </div>
          </section>
        ) : null}

        {page === 'verification' && actionMessage && <p className={`action-message ${actionMessage.kind}`} role="status">{actionMessage.text}</p>}
        {accessToken && page === 'review-requests' && <ReviewRequests baseUrl={API_BASE} token={accessToken} canRestore={Boolean(account?.staff_profile?.permissions.includes("RESTORE_COMPANY"))} />}
        {accessToken && page === 'catalogue' && <Catalogue baseUrl={API_BASE} token={accessToken} permissions={account?.staff_profile?.permissions ?? []} />}
        {accessToken && page === 'dealers' && <Dealers baseUrl={API_BASE} token={accessToken} permissions={account?.staff_profile?.permissions ?? []} />}
        <footer>Company verification and private-document access are authorized by the backend for each request.</footer>
      </main>
    </div>
  );
}

export default App;
