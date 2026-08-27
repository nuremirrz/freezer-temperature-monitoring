"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail, Lock, User } from "lucide-react";
import AuthLayout from "@/components/auth/AuthLayout";
import { TextField, AuthDivider, GoogleIcon, LockNote, useDemoToast } from "@/components/auth/fields";
import { signIn } from "@/lib/auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Errors = Partial<Record<"name" | "email" | "password" | "confirm" | "terms", string>>;

export default function RegisterPage() {
  const router = useRouter();
  const toast = useDemoToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: Errors = {};
    if (!name.trim()) next.name = "Full name is required";
    if (!email.trim()) next.email = "Email is required";
    else if (!EMAIL_RE.test(email)) next.email = "Enter a valid email address";
    if (!password) next.password = "Password is required";
    else if (password.length < 6) next.password = "Password must be at least 6 characters";
    if (!confirm) next.confirm = "Please confirm your password";
    else if (confirm !== password) next.confirm = "Passwords do not match";
    if (!terms) next.terms = "You must agree to the Terms of Service";
    setErrors(next);
    if (Object.keys(next).length) return;

    signIn();
    router.push("/locations");
  };

  return (
    <AuthLayout
      headline={["Set up your team.", "Monitor every location."]}
      subtext="Create your account to onboard your team, connect your locations, and get real-time freezer temperature visibility."
    >
      <h2 className="text-center text-2xl font-semibold">Create account</h2>
      <p className="mt-1 mb-6 text-center text-sm text-muted">
        Set up access to your monitoring dashboard
      </p>

      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField
          label="Full name"
          placeholder="Enter your full name"
          icon={<User size={16} />}
          value={name}
          onChange={setName}
          error={errors.name}
          autoComplete="name"
        />
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
          placeholder="Create a password"
          icon={<Lock size={16} />}
          value={password}
          onChange={setPassword}
          error={errors.password}
          autoComplete="new-password"
        />
        <TextField
          label="Confirm password"
          type="password"
          placeholder="Confirm your password"
          icon={<Lock size={16} />}
          value={confirm}
          onChange={setConfirm}
          error={errors.confirm}
          autoComplete="new-password"
        />

        <div className="pt-1">
          <label className="flex cursor-pointer items-start gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
              className="mt-0.5 size-4 rounded border-line accent-primary"
            />
            <span>
              I agree to the{" "}
              <span className="font-medium text-accent">Terms of Service</span> and{" "}
              <span className="font-medium text-accent">Privacy Policy</span>
            </span>
          </label>
          {errors.terms && <span className="mt-1 block text-xs text-alert">{errors.terms}</span>}
        </div>

        <button
          type="submit"
          className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          Create account
        </button>
      </form>

      <AuthDivider />

      <button
        onClick={() => toast.show()}
        className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-line py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-page"
      >
        <GoogleIcon /> Sign up with Google
      </button>
      <button
        onClick={() => toast.show()}
        className="mt-4 w-full text-center text-sm font-medium text-accent hover:underline"
      >
        Sign up with SSO
      </button>

      <div className="mt-5 border-t border-line-soft pt-4 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </div>

      <LockNote />
      {toast.node}
    </AuthLayout>
  );
}
