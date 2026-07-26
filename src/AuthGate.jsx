import { useEffect, useState } from "react";
import { IconAlertCircle, IconLoader2, IconLockPassword } from "@tabler/icons-react";

const THEME_STORAGE_KEY = "trialr-v2-theme";

function resolveTheme() {
  let preference = "system";
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") preference = saved;
  } catch {
    // Fall back to the system preference when storage is unavailable.
  }
  if (preference !== "system") return preference;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function AuthGate({ children }) {
  const [status, setStatus] = useState({ loading: true, required: false, misconfigured: false, authenticated: false });
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const locked = !status.loading && status.required && !status.authenticated;

  useEffect(() => {
    let active = true;
    fetch("/api/auth/status")
      .then((response) => response.json())
      .then((data) => {
        if (active) setStatus({ loading: false, ...data });
      })
      .catch(() => {
        if (active) setStatus({ loading: false, required: false, misconfigured: false, authenticated: false });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!locked) return undefined;
    document.body.classList.add("trialr-body");
    const theme = resolveTheme();
    document.documentElement.dataset.trialrTheme = theme;
    document.documentElement.style.colorScheme = theme;
    return () => {
      document.body.classList.remove("trialr-body");
      delete document.documentElement.dataset.trialrTheme;
      document.documentElement.style.removeProperty("color-scheme");
    };
  }, [locked]);

  async function submit(event) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Sign in failed.");
      setPassword("");
      setStatus((current) => ({ ...current, authenticated: true }));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Sign in failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (status.loading) return null;
  if (!locked) return children;

  return (
    <main className="auth-screen-studio">
      <form className="auth-panel" onSubmit={submit}>
        <div className="auth-mark" aria-hidden="true"><IconLockPassword size={16} stroke={1.7} /></div>
        <h1>Trialr</h1>
        {status.misconfigured ? (
          <p className="auth-note auth-error">
            <IconAlertCircle size={15} aria-hidden="true" />
            This deployment has no password set. Add TRIALR_PASSWORD to the server environment and redeploy.
          </p>
        ) : (
          <>
            <p className="auth-note">Enter your passphrase to continue.</p>
            <label className="auth-field">
              <span>Passphrase</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoFocus
                autoComplete="current-password"
                placeholder="••••••••"
              />
            </label>
            <button type="submit" className="auth-submit" disabled={submitting || !password}>
              {submitting ? <IconLoader2 size={16} className="spin" aria-hidden="true" /> : <IconLockPassword size={16} aria-hidden="true" />}
              {submitting ? "Checking" : "Unlock"}
            </button>
            {error && (
              <p className="auth-note auth-error" role="alert">
                <IconAlertCircle size={15} aria-hidden="true" />
                {error}
              </p>
            )}
          </>
        )}
      </form>
    </main>
  );
}
