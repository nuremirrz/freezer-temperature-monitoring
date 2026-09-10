"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, AlertTriangle } from "lucide-react";
import AuthLayout from "@/components/auth/AuthLayout";
import { TextField, LockNote } from "@/components/auth/fields";
import { authApi } from "@/lib/auth-client";

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!token) {
    return (
      <div className="text-center">
        <AlertTriangle size={28} className="mx-auto text-warn" />
        <h2 className="mt-3 text-2xl font-semibold">Link is incomplete</h2>
        <p className="mt-2 text-sm text-muted">Open the reset link from your e-mail again, or request a new one.</p>
        <Link href="/forgot-password" className="mt-5 inline-block text-sm font-medium text-accent hover:underline">
          Request a new link
        </Link>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!password) next.password = "Password is required";
    else if (password.length < 8) next.password = "Password must be at least 8 characters";
    if (confirm !== password) next.confirm = "Passwords do not match";
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;

    setBusy(true);
    const res = await authApi.resetPassword(token, password);
    setBusy(false);
    if (!res.ok) {
      setFormError(res.error.message);
      return;
    }
    router.push("/login?reset=1");
  };

  return (
    <>
      <h2 className="text-center text-2xl font-semibold">Set a new password</h2>
      <p className="mt-1 mb-6 text-center text-sm text-muted">You&apos;ll be signed out everywhere else</p>

      {formError && (
        <div className="mb-4 rounded-lg bg-alert-soft px-3 py-2.5 text-sm text-alert">
          {formError}{" "}
          <Link href="/forgot-password" className="font-medium underline">
            Request a new link
          </Link>
        </div>
      )}

      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField
          label="New password"
          type="password"
          placeholder="At least 8 characters"
          icon={<Lock size={16} />}
          value={password}
          onChange={setPassword}
          error={errors.password}
          autoComplete="new-password"
        />
        <TextField
          label="Confirm new password"
          type="password"
          placeholder="Repeat the new password"
          icon={<Lock size={16} />}
          value={confirm}
          onChange={setConfirm}
          error={errors.confirm}
          autoComplete="new-password"
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {busy ? "Saving…" : "Update password"}
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthLayout
      headline={["Real-time visibility.", "Safer cold storage."]}
      subtext="Monitor freezer temperatures, receive instant alerts, and keep every location operating within range."
    >
      <Suspense fallback={null}>
        <ResetForm />
      </Suspense>
      <LockNote />
    </AuthLayout>
  );
}
