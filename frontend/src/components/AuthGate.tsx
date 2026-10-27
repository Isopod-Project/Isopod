import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, Lock, LogOut, RefreshCw } from "lucide-react";
import { AuthContext, useAuth } from "../lib/auth";

// Dashboard login (#143). The backend answers every /api call without a session with 401,
// so the gate checks /api/auth/status first and shows setup or login until there is one.

type AuthStatus = { setup_required: boolean; authenticated: boolean; username: string | null };
type AuthState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; status: AuthStatus };

const UNAUTHORIZED_EVENT = "isopod:unauthorized";

// Any API call that comes back 401 means the session expired or was revoked elsewhere
// (e.g. a password change). Send the user back to the login screen instead of letting
// every panel fail on its own.
let fetchPatched = false;
function watchForExpiredSessions() {
   if (fetchPatched) return;
   fetchPatched = true;
   const originalFetch = window.fetch.bind(window);
   window.fetch = async (input, init) => {
      const res = await originalFetch(input, init);
      if (res.status === 401) {
         const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
         if (url.origin === window.location.origin && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/")) {
            window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
         }
      }
      return res;
   };
}

async function errorDetail(res: Response, fallback: string) {
   try {
      const body = await res.json();
      if (typeof body?.detail === "string") return body.detail;
   } catch { /* not JSON */ }
   return fallback;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
   const [state, setState] = useState<AuthState>({ kind: "loading" });

   const refresh = useCallback(async () => {
      try {
         const res = await fetch("/api/auth/status");
         if (!res.ok) throw new Error(`status ${res.status}`);
         setState({ kind: "ready", status: await res.json() });
      } catch {
         setState({ kind: "error" });
      }
   }, []);

   useEffect(() => {
      watchForExpiredSessions();
      refresh();
      const onUnauthorized = () =>
         setState((s) => (s.kind === "ready" && s.status.authenticated ? { kind: "ready", status: { ...s.status, authenticated: false, username: null } } : s));
      window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
      return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
   }, [refresh]);

   const logout = useCallback(async () => {
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
      setState({ kind: "ready", status: { setup_required: false, authenticated: false, username: null } });
   }, []);

   if (state.kind === "loading") {
      return (
         <Screen>
            <div className="flex items-center justify-center gap-2 text-neutral-400">
               <RefreshCw className="w-5 h-5 animate-spin" /> Loading...
            </div>
         </Screen>
      );
   }
   if (state.kind === "error") {
      return (
         <Screen>
            <div role="alert" className="flex flex-col items-center text-center gap-3 text-neutral-400">
               <AlertCircle className="w-12 h-12 opacity-50" />
               <p className="font-bold text-neutral-200">Can't reach Isopod</p>
               <p className="text-sm">The dashboard can't connect to the Isopod backend. Check that it's running.</p>
               <button onClick={refresh} className="px-4 py-1.5 rounded bg-[#3E8ED0] hover:bg-[#4B9BE0] text-white font-bold text-sm">Retry</button>
            </div>
         </Screen>
      );
   }
   if (!state.status.authenticated) {
      return <LoginForm setup={state.status.setup_required} onDone={refresh} />;
   }
   return <AuthContext.Provider value={{ username: state.status.username, logout }}>{children}</AuthContext.Provider>;
}

function Screen({ children }: { children: React.ReactNode }) {
   return (
      <div className="min-h-screen flex items-center justify-center bg-[#1A1A1A] text-[#E0E0E0] p-4">
         <div className="w-full max-w-sm bg-[#242424] border border-[#3A3A3A] rounded-xl shadow-2xl p-8">{children}</div>
      </div>
   );
}

const inputClass = "w-full bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3E8ED0]";

function LoginForm({ setup, onDone }: { setup: boolean; onDone: () => void }) {
   const [username, setUsername] = useState("");
   const [password, setPassword] = useState("");
   const [confirm, setConfirm] = useState("");
   const [error, setError] = useState("");
   const [busy, setBusy] = useState(false);

   const submit = async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");
      if (setup && password !== confirm) {
         setError("Passwords don't match.");
         return;
      }
      setBusy(true);
      try {
         const res = await fetch(setup ? "/api/auth/setup" : "/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
         });
         if (!res.ok) {
            setError(await errorDetail(res, setup ? "Couldn't create the account." : "Couldn't log in."));
            return;
         }
         onDone();
      } catch {
         setError("Can't reach Isopod. Check that it's running.");
      } finally {
         setBusy(false);
      }
   };

   return (
      <Screen>
         <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2 mb-2 text-center">
               <img src="/logo.png" alt="" className="w-14 h-14" />
               <h1 className="text-xl font-bold text-white">{setup ? "Set up Isopod" : "Log in to Isopod"}</h1>
               {setup && <p className="text-sm text-neutral-400">Create the admin account. You'll use it to log in to this dashboard.</p>}
            </div>
            <label className="flex flex-col gap-1 text-sm">
               <span className="font-bold text-neutral-300">Username</span>
               <input className={inputClass} autoComplete="username" autoFocus required value={username} onChange={(e) => setUsername(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
               <span className="font-bold text-neutral-300">Password</span>
               <input className={inputClass} type="password" autoComplete={setup ? "new-password" : "current-password"} required minLength={setup ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {setup && (
               <label className="flex flex-col gap-1 text-sm">
                  <span className="font-bold text-neutral-300">Confirm password</span>
                  <input className={inputClass} type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
               </label>
            )}
            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
            <button type="submit" disabled={busy} className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#3E8ED0] hover:bg-[#4B9BE0] text-white font-bold text-sm disabled:opacity-50">
               <Lock className="w-4 h-4" /> {setup ? "Create account" : "Log in"}
            </button>
         </form>
      </Screen>
   );
}

export function AccountSettings() {
   const { username, logout } = useAuth();
   const [current, setCurrent] = useState("");
   const [next, setNext] = useState("");
   const [confirm, setConfirm] = useState("");
   const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
   const [busy, setBusy] = useState(false);

   const changePassword = async (e: React.FormEvent) => {
      e.preventDefault();
      if (next !== confirm) {
         setMessage({ ok: false, text: "New passwords don't match." });
         return;
      }
      setBusy(true);
      try {
         const res = await fetch("/api/auth/password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ current_password: current, new_password: next }),
         });
         if (!res.ok) {
            setMessage({ ok: false, text: await errorDetail(res, "Couldn't change the password.") });
            return;
         }
         setCurrent(""); setNext(""); setConfirm("");
         setMessage({ ok: true, text: "Password changed. Other browsers have been logged out." });
      } catch {
         setMessage({ ok: false, text: "Can't reach Isopod." });
      } finally {
         setBusy(false);
      }
   };

   return (
      <div className="space-y-8 animate-in slide-in-from-bottom-2 duration-300">
         <div>
            <h3 className="text-lg font-bold mb-1">Account</h3>
            <p className="text-sm text-neutral-500">The admin account that logs in to this dashboard.</p>
         </div>
         <div className="flex items-center justify-between p-4 bg-[#242424] rounded-lg border border-[#333]">
            <div className="flex flex-col">
               <span className="font-bold text-sm">Logged in as {username}</span>
               <span className="text-xs text-neutral-500">Sessions last 30 days.</span>
            </div>
            <button onClick={logout} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#3A3A3A] hover:bg-[#333] text-sm font-bold">
               <LogOut className="w-4 h-4" /> Log out
            </button>
         </div>
         <form onSubmit={changePassword} className="space-y-3 p-4 bg-[#242424] rounded-lg border border-[#333]">
            <span className="font-bold text-sm">Change password</span>
            <input className={inputClass} type="password" aria-label="Current password" placeholder="Current password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
            <input className={inputClass} type="password" aria-label="New password" placeholder="New password (at least 8 characters)" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />
            <input className={inputClass} type="password" aria-label="Confirm new password" placeholder="Confirm new password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {message && <p role="alert" className={`text-sm ${message.ok ? "text-green-400" : "text-red-400"}`}>{message.text}</p>}
            <button type="submit" disabled={busy} className="px-4 py-1.5 rounded-lg bg-[#3E8ED0] hover:bg-[#4B9BE0] text-white font-bold text-sm disabled:opacity-50">Change password</button>
         </form>
      </div>
   );
}
