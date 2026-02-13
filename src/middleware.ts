import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import authConfig from "../auth.config";

const { auth } = NextAuth(authConfig);

// Routes that require authentication
const protectedPrefixes = ["/bets", "/trends/saved"];

// Auth-only pages (redirect logged-in users away from these)
const authPages = ["/login", "/signup"];

function isProtectedRoute(pathname: string): boolean {
  return protectedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );
}

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;

  // Set Sentry user context for authenticated requests
  if (isLoggedIn && req.auth?.user) {
    Sentry.setUser({
      id: req.auth.user.id ?? undefined,
      email: req.auth.user.email ?? undefined,
    });
  } else {
    Sentry.setUser(null);
  }

  // Protected routes require login
  if (!isLoggedIn && isProtectedRoute(nextUrl.pathname)) {
    return NextResponse.redirect(new URL("/login", nextUrl));
  }

  // Redirect logged-in users away from login/signup
  if (isLoggedIn && authPages.includes(nextUrl.pathname)) {
    return NextResponse.redirect(new URL("/", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|monitoring).*)"],
};
