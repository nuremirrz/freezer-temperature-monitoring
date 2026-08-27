"use client";

const AUTH_COOKIE = "ftm_auth";

export function signIn() {
  document.cookie = `${AUTH_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 7}`;
}

export function signOut() {
  document.cookie = `${AUTH_COOKIE}=; path=/; max-age=0`;
}
