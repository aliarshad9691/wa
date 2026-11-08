import { NextResponse } from "next/server";
import { auth } from "@/auth";

const PUBLIC = ["/login", "/api/auth"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (req.auth?.user) return NextResponse.next();
  console.warn("[auth] proxy denied", {
    path: pathname,
    hasSessionCookie: req.cookies.getAll().some((c) => c.name.includes("session-token")),
    rsc: req.headers.has("rsc"),
  });
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL("/login", req.nextUrl.origin);
  if (pathname !== "/") url.searchParams.set("callbackUrl", pathname);
  return NextResponse.redirect(url);
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|webmanifest)$).*)"],
};
