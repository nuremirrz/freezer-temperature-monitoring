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

export function LockNote() {
  return (
    <div className="mt-5 flex items-center justify-center gap-1.5 text-xs text-faint">
      <Lock size={12} />
      Authorized personnel only
    </div>
  );
}

