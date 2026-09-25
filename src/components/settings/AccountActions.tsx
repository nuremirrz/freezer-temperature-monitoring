"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, LogOut, Trash2 } from "lucide-react";
import { authApi } from "@/lib/auth-client";
import { useMe } from "@/components/SessionProvider";

export default function AccountActions() {
  const me = useMe();
  // Only Qimby's own team may delete their account; for everyone else the owner deactivates.
  const canDelete = me.role === "admin";
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"delete" | "logoutAll" | null>(null);

  const signOutEverywhere = async () => {
    setBusy("logoutAll");
    await authApi.logoutEverywhere();
    router.push("/login?signed_out=1");
    router.refresh();
  };

  const remove = async () => {
    setBusy("delete");
    setError(null);
    const res = await authApi.deleteAccount(password);
    setBusy(null);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    router.push("/login?deleted=1");
    router.refresh();
  };

  return (
    <>
      <section className="mt-4 rounded-xl border border-line bg-panel p-5">
        <h2 className="text-sm font-semibold">Sessions</h2>
        <p className="mt-1 text-sm text-muted">
          Signs you out on every device and browser, including this one.
        </p>
        <button
          onClick={signOutEverywhere}
          disabled={busy !== null}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-offline-soft disabled:opacity-60"
        >
          <LogOut size={15} /> Sign out everywhere
        </button>
      </section>

      {!canDelete && (
        <section className="mt-4 rounded-xl border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold">Leaving</h2>
          <p className="mt-1 text-sm text-muted">
            Accounts here are not deleted, so that your name stays on the work you recorded. Ask
            the owner of your organization to deactivate your account.
          </p>
        </section>
      )}

      {canDelete && (
      <section className="mt-4 rounded-xl border border-alert/30 bg-panel p-5">
        <h2 className="text-sm font-semibold text-alert">Delete account</h2>
        <p className="mt-1 text-sm text-muted">
          Removes your login permanently. Sensor readings, alerts and equipment records are not
          tied to your account and stay in the system.
        </p>
        <button
          onClick={() => setConfirmOpen(true)}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-alert/40 px-4 py-2 text-sm font-medium text-alert transition-colors hover:bg-alert-soft"
        >
          <Trash2 size={15} /> Delete my account
        </button>
      </section>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-ink/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-panel p-6 shadow-xl">
            <div className="mb-3 flex items-center gap-2 text-alert">
              <AlertTriangle size={18} />
              <span className="text-lg font-semibold text-ink">Delete account?</span>
            </div>
            <p className="mb-4 text-sm text-muted">
              This can&apos;t be undone. Enter your password to confirm.
            </p>
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-line px-3.5 py-2.5 text-sm outline-none focus:border-accent"
            />
            {error && <p className="mt-2 text-xs text-alert">{error}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => {
                  setConfirmOpen(false);
                  setPassword("");
                  setError(null);
                }}
                className="rounded-lg border border-line px-5 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-offline-soft"
              >
                Cancel
              </button>
              <button
                onClick={remove}
                disabled={!password || busy === "delete"}
                className="rounded-lg bg-alert px-5 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-60"
              >
                {busy === "delete" ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
