"use client";

/** Thin fetch wrappers for the auth API, used by the login/register/settings screens. */

export interface ApiError {
  error: string;
  message: string;
  field?: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };

export async function call<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
      credentials: "same-origin",
    });
    const body = (await res.json().catch(() => ({}))) as T & ApiError;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: { error: body.error ?? "error", message: body.message ?? "Something went wrong", field: body.field },
      };
    }
    return { ok: true, data: body };
  } catch {
    return { ok: false, status: 0, error: { error: "network", message: "Network error — check your connection" } };
  }
}

export const authApi = {
  login: (data: { email: string; password: string; rememberMe: boolean }) =>
    call<{ user: { email: string } }>("/api/auth/login", { method: "POST", body: JSON.stringify(data) }),
  logout: () => call<{ status: string }>("/api/auth/logout", { method: "POST", body: "{}" }),
  logoutEverywhere: () => call<{ status: string }>("/api/auth/logout?all=1", { method: "POST", body: "{}" }),
  resendVerification: (email: string) =>
    call<{ status: string; devVerifyUrl?: string }>("/api/auth/resend-verification", { method: "POST", body: JSON.stringify({ email }) }),
  forgotPassword: (email: string) =>
    call<{ status: string; devResetUrl?: string }>("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) =>
    call<{ status: string }>("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) }),
  deleteAccount: (password: string) =>
    call<{ status: string }>("/api/auth/account", { method: "DELETE", body: JSON.stringify({ password }) }),
};
