"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail, Lock } from "lucide-react";
import AuthLayout from "@/components/auth/AuthLayout";
import { TextField, AuthDivider, GoogleIcon, LockNote, useDemoToast } from "@/components/auth/fields";
import { signIn } from "@/lib/auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  const router = useRouter();
  const toast = useDemoToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!email.trim()) next.email = "Email is required";
    else if (!EMAIL_RE.test(email)) next.email = "Enter a valid email address";
    if (!password) next.password = "Password is required";
    setErrors(next);
    if (Object.keys(next).length) return;

    signIn();
    router.push("/locations");
  };

  return (
    <AuthLayout
      headline={["Real-time visibility.", "Safer cold storage."]}
      subtext="Monitor freezer temperatures, receive instant alerts, and keep every location operating within range."
    >
      <h2 className="text-center text-2xl font-semibold">Sign in</h2>
      <p className="mt-1 mb-6 text-center text-sm text-muted">
        Access your monitoring dashboard
      </p>

      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField
          label="Work email"
          type="email"
          placeholder="name@burgerking.com"
          icon={<Mail size={16} />}
          value={email}
          onChange={setEmail}
          error={errors.email}
          autoComplete="email"
        />
        <TextField
          label="Password"
          type="password"
          placeholder="Enter your password"
          icon={<Lock size={16} />}
          value={password}
          onChange={setPassword}
          error={errors.password}
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
          <button
            type="button"
            onClick={() => toast.show()}
            className="text-sm font-medium text-accent hover:underline"
          >
            Forgot password?
          </button>
        </div>

        <button
          type="submit"
          className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          Sign in
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

      <div className="mt-5 border-t border-line-soft pt-1 text-center text-sm text-muted">
        <span className="mt-3 inline-block">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="font-medium text-accent hover:underline">
            Create account
          </Link>
        </span>
      </div>

      <LockNote />
      {toast.node}
    </AuthLayout>
  );
}
