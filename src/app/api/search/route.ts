import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";

export async function GET(req: Request) {
  const { acct, deny } = await requireUser();
  if (deny) return deny;
  const q = new URL(req.url).searchParams.get("q")?.trim() || "";
  if (q.length < 2) return NextResponse.json({ messages: [] });
  return NextResponse.json({ messages: acct.repo.searchMessages(q, 60) });
}
