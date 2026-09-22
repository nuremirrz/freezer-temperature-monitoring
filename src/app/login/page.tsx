"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, Lock, CheckCircle2, AlertTriangle } from "lucide-react";
import AuthLayout from "@/components/auth/AuthLayout";
import { TextField, AuthDivider, GoogleIcon, LockNote, useDemoToast } from "@/components/auth/fields";
import { authApi } from "@/lib/auth-client";

const BANNERS: Record<string, { tone: "ok" | "warn"; text: string }> = {
  verified: { tone: "ok", text: "E-mail confirmed. You can sign in now." },
  reset: { tone: "ok", text: "Password updated. Sign in with the new one." },
  deleted: { tone: "ok", text: "Your account has been deleted." },
  signed_out: { tone: "ok", text: "You have been signed out." },
  verify_error: { tone: "warn", text: "That confirmation link is invalid or has expired. Request a new one below." },
};

function Banner({ tone, text }: { tone: "ok" | "warn"; text: string }) {
  const Icon = tone === "ok" ? CheckCircle2 : AlertTriangle;
  return (
    <div
      className={`mb-4 flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm ${
        tone === "ok" ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"
      }`}
    >
      <Icon size={16} className="mt-0.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useDemoToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState<string | null>(null);

  const bannerKey = Object.keys(BANNERS).find((k) => params.get(k) === "1");
  const banner = bannerKey ? BANNERS[bannerKey] : null;
  const nextPath = params.get("next");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof fieldErrors = {};
    if (!email.trim()) next.email = "E-mail is required";
    if (!password) next.password = "Password is required";
    setFieldErrors(next);
    setFormError(null);
    setUnverified(false);
    if (Object.keys(next).length) return;

    setBusy(true);
    const res = await authApi.login({ email, password, rememberMe: remember });
    setBusy(false);

    if (!res.ok) {
      if (res.error.error === "email_not_verified") setUnverified(true);
      else if (res.error.field === "email") setFieldErrors({ email: res.error.message });
      else setFormError(res.error.message);
      return;
    }
    const target = nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/locations";
    router.push(target);
    router.refresh();
  };

  const resend = async () => {
    const res = await authApi.resendVerification(email);
    setResent(res.ok ? (res.data.devVerifyUrl ?? "sent") : res.error.message);
  };

  return (
    <>
      <h2 className="text-center text-2xl font-semibold">Sign in</h2>
      <p className="mt-1 mb-6 text-center text-sm text-muted">Access your monitoring dashboard</p>

      {banner && <Banner {...banner} />}

      {unverified && (
        <div className="mb-4 rounded-lg bg-warn-soft px-3 py-2.5 text-sm text-warn">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              Confirm your e-mail address first — check your inbox for the link.{" "}
              <button type="button" onClick={resend} className="font-medium underline">
                Send it again
              </button>
              {resent && resent !== "sent" && !resent.startsWith("http") && (
                <div className="mt-1 text-xs">{resent}</div>
              )}
              {resent === "sent" && <div className="mt-1 text-xs">Sent — check your inbox.</div>}
              {resent?.startsWith("http") && (
                <div className="mt-1 text-xs break-all">
                  Dev mode (no SMTP): <a href={resent} className="underline">{resent}</a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {formError && <Banner tone="warn" text={formError} />}

      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField
          label="Work email"
          type="email"
          placeholder="name@burgerking.com"
          icon={<Mail size={16} />}
          value={email}
          onChange={setEmail}
          error={fieldErrors.email}
          autoComplete="email"
        />
        <TextField
          label="Password"
          type="password"
          placeholder="Enter your password"
          icon={<Lock size={16} />}
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
          autoComplete="current-password"
        />

        <div className="flex items-center justify-between pt-1">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="size-4 rounded border-line accent-primary"
            />
            Remember me
          </label>
          <Link href="/forgot-password" className="text-sm font-medium text-accent hover:underline">
            Forgot password?
          </Link>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <AuthDivider />

      <button
        onClick={() => toast.show()}
        className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-line py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-page"
      >
        <GoogleIcon /> Sign in with Google
      </button>
      <button
        onClick={() => toast.show()}
        className="mt-4 w-full text-center text-sm font-medium text-accent hover:underline"
      >
        Sign in with SSO
      </button>

      <div className="mt-5 border-t border-line-soft pt-4 text-center text-sm text-muted">
        Accounts are created by invitation — ask the owner of your organization for a link.
      </div>

      <LockNote />
      {toast.node}
    </>
  );
}

export default function LoginPage() {
  return (
    <AuthLayout
      headline={["Real-time visibility.", "Safer cold storage."]}
      subtext="Monitor freezer temperatures, receive instant alerts, and keep every location operating within range."
    >
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthLayout>
  );
}
