import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";

export async function GET() {
  const { acct, deny } = await requireUser();
  if (deny) return deny;
  return NextResponse.json({ chats: acct.repo.listChats() });
}
