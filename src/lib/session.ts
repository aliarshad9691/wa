import "server-only";
import { auth } from "@/auth";
import { NextResponse } from "next/server";

/** Defence in depth: every API route re-checks the session (the proxy also does). */
export async function requireUser() {
  const session = await auth();
  if (!session?.user) {
    return { user: null, deny: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  }
  return { user: session.user, deny: null } as const;
}
