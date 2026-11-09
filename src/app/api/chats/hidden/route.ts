import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { listChats } from "@/lib/wa/repo";

/**
 * Filtered numbers' chats are hidden from the sidebar. They are returned here only when the
 * search text equals HIDDEN_CHATS_CODE (checked on the server, so the code never reaches the page).
 */
export async function GET(req: Request) {
  const { deny } = await requireUser();
  if (deny) return deny;
  const code = process.env.HIDDEN_CHATS_CODE?.trim();
  const q = new URL(req.url).searchParams.get("code")?.trim();
  if (!code || q !== code) return NextResponse.json({ chats: [] });
  return NextResponse.json({ chats: listChats({ hidden: true }) });
}
