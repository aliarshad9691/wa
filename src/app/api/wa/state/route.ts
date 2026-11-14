import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { checkStorage } from "@/lib/storage";

export async function GET() {
  const { acct, deny } = await requireUser();
  if (deny) return deny;
  return NextResponse.json({ state: acct.wa.state, storage: await checkStorage(), hasSession: acct.wa.hasSession() });
}
