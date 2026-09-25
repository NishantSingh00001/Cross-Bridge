import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Nav, Panel } from "../components/ui";
import { api, setSession, type Session } from "../lib/api";

export default function Login() {
  const [error, setError] = useState("");
  const navigate = useNavigate();
  useEffect(() => {
    const token = location.hash.slice(1);
    history.replaceState(null, "", "/login");
    if (!token) { setError("This page needs the link the bot sent you."); return; }
    api<Session>("/api/auth/exchange", { body: { token } })
      .then((s) => { setSession(s); navigate("/dashboard", { replace: true }); })
      .catch((e) => setError(e.message));
  }, [navigate]);
  return (
    <>
      <Nav />
      <main className="page" style={{ maxWidth: 640 }}>
        <Panel fig="SIGN IN" className="panel--pad">
          {error ? (
            <>
              <h1 className="h2" style={{ fontSize: "2rem" }}>Couldn't sign you in</h1>
              <p className="muted">{error}</p>
              <p className="muted">Send <code>/login</code> to the CrossBridge bot in a private Telegram chat to get a fresh link.</p>
              <Link to="/dashboard" className="btn btn--sm">Back to the dashboard</Link>
            </>
          ) : (
            <div className="row"><span className="spinner" /> Signing you in…</div>
          )}
        </Panel>
      </main>
    </>
  );
}
