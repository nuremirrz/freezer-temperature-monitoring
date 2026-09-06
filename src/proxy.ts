import { NextRequest, NextResponse } from "next/server";

const AUTH_COOKIE = "ftm_auth";

export function proxy(req: NextRequest) {
  const authed = req.cookies.get(AUTH_COOKIE)?.value === "1";
  const { pathname } = req.nextUrl;
  const isAuthPage = pathname === "/login" || pathname === "/register";

  if (!authed && !isAuthPage) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (authed && isAuthPage) {
    return NextResponse.redirect(new URL("/locations", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/locations/:path*", "/maintenance/:path*", "/login", "/register"],
};
