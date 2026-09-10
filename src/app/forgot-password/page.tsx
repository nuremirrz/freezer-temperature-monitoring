"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail, MailCheck } from "lucide-react";
import AuthLayout from "@/components/auth/AuthLayout";
import { TextField, LockNote } from "@/components/auth/fields";
import { authApi } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ devResetUrl?: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError("E-mail is required");
      return;
    }
    setError(undefined);
    setBusy(true);
    const res = await authApi.forgotPassword(email);
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setSent({ devResetUrl: res.data.devResetUrl });
  };

  return (
    <AuthLayout
      headline={["Real-time visibility.", "Safer cold storage."]}
      subtext="Monitor freezer temperatures, receive instant alerts, and keep every location operating within range."
    >
      {sent ? (
        <div className="flex flex-col items-center text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-ok-soft">
            <MailCheck size={26} className="text-ok" />
          </span>
          <h2 className="mt-4 text-2xl font-semibold">Check your inbox</h2>
          <p className="mt-2 text-sm text-muted">
            If an account exists for <span className="font-medium text-ink">{email.trim().toLowerCase()}</span>,
            we sent a link to set a new password. It is valid for one hour.
          </p>
          {sent.devResetUrl && (
            <div className="mt-4 w-full rounded-lg bg-warn-soft px-3 py-2.5 text-left text-xs text-warn break-all">
              <div className="font-semibold">Dev mode — no SMTP configured</div>
              <a href={sent.devResetUrl} className="underline">
                {sent.devResetUrl}
              </a>
            </div>
          )}
          <Link href="/login" className="mt-5 text-sm font-medium text-accent hover:underline">
            Back to sign in
          </Link>
        </div>
      ) : (
        <>
          <h2 className="text-center text-2xl font-semibold">Forgot password</h2>
          <p className="mt-1 mb-6 text-center text-sm text-muted">
            Enter your work e-mail and we&apos;ll send you a reset link
          </p>
          <form onSubmit={submit} noValidate className="space-y-4">
            <TextField
              label="Work email"
              type="email"
              placeholder="name@burgerking.com"
              icon={<Mail size={16} />}
              value={email}
              onChange={setEmail}
              error={error}
              autoComplete="email"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </form>
          <div className="mt-5 border-t border-line-soft pt-4 text-center text-sm text-muted">
            Remembered it?{" "}
            <Link href="/login" className="font-medium text-accent hover:underline">
              Sign in
            </Link>
          </div>
        </>
      )}
      <LockNote />
    </AuthLayout>
  );
}
