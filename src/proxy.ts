import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "qimby_session";
/** Reachable without a session */
const AUTH_PAGES = new Set(["/login", "/register", "/forgot-password", "/reset-password"]);
/** Pointless while signed in */
const GUEST_ONLY = new Set(["/login", "/register"]);

/**
 * Fast cookie-presence gate. The real check (session exists, not expired) happens in the
 * (app) layout and in every protected API route — this only saves an unauthenticated
 * visitor a round-trip.
 */
export function proxy(req: NextRequest) {
  const hasCookie = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = req.nextUrl;

  if (!hasCookie && !AUTH_PAGES.has(pathname)) {
    const login = new URL("/login", req.url);
    if (pathname !== "/") login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  if (hasCookie && GUEST_ONLY.has(pathname)) {
    return NextResponse.redirect(new URL("/locations", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/locations/:path*",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
  ],
};
