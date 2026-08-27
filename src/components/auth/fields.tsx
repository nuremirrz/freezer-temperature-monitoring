"use client";

import { useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";

export function TextField({
  label,
  type = "text",
  placeholder,
  icon,
  value,
  onChange,
  error,
  autoComplete,
}: {
  label: string;
  type?: string;
  placeholder: string;
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword && show ? "text" : type;

  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-soft">{label}</span>
      <span
        className={`flex items-center gap-2.5 rounded-lg border bg-panel px-3.5 py-2.5 transition-colors focus-within:border-accent ${
          error ? "border-alert" : "border-line"
        }`}
      >
        <span className="text-faint">{icon}</span>
        <input
          type={inputType}
          placeholder={placeholder}
          value={value}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
        />
        {isPassword && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShow((s) => !s)}
            className="text-faint transition-colors hover:text-muted"
          >
            {show ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
        )}
      </span>
      {error && <span className="mt-1 block text-xs text-alert">{error}</span>}
    </label>
  );
}

export function AuthDivider() {
  return (
    <div className="my-5 flex items-center gap-4">
      <span className="h-px flex-1 bg-line" />
      <span className="text-xs text-faint">or</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.1 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.1 18.9 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}

export function LockNote() {
  return (
    <div className="mt-5 flex items-center justify-center gap-1.5 text-xs text-faint">
      <Lock size={12} />
      Authorized Burger King operations only
    </div>
  );
}

export function useDemoToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const show = (m = "Not available in demo") => {
    setMsg(m);
    setTimeout(() => setMsg(null), 2200);
  };
  const node = msg ? (
    <div className="fixed bottom-8 left-1/2 z-[1200] -translate-x-1/2 rounded-lg bg-primary px-4 py-2.5 text-sm text-white shadow-lg">
      {msg}
    </div>
  ) : null;
  return { show, node };
}
