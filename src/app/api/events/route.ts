import { requireUser } from "@/lib/session";
import { listAccounts } from "@/lib/accounts";
import type { WAEvent } from "@/lib/wa/manager";

export const dynamic = "force-dynamic";

/**
 * Server-sent events for the open WhatsApp account (`?a=<id>`): connection state, new/updated
 * messages, chat list changes. Plus "accounts" whenever any account's status or unread count
 * may have changed, so the account switcher stays current.
 */
export async function GET(req: Request) {
  const { acct, deny } = await requireUser();
  if (deny) return deny;
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };
      send("state", acct.wa.state);
      const onEvent = (e: WAEvent) => {
        if (e.type === "state") send("state", e.state);
        else if (e.type === "chats") send("chats", {});
        else if (e.type === "history") send("history", { chatIds: e.chatIds });
        else if (e.type === "message") {
          // Hidden chats: no content on the stream (it was opened without the unlock). The open
          // chat re-reads its messages through the guarded messages API instead.
          if (acct.repo.isHiddenChat(e.chatId)) return send("chat-changed", { chatId: e.chatId });
          const row = acct.repo.getMessage(e.chatId, e.messageId);
          if (row) send("message", { isNew: e.isNew, message: acct.repo.toDTO(row) });
        }
      };
      acct.wa.bus.on("event", onEvent);

      // Every account (including this one): status changes and chat list changes move the switcher.
      // State events also carry sync/media progress (every second while busy): only a new status counts.
      let accountsTimer: NodeJS.Timeout | null = null;
      const subs = listAccounts().map((a) => {
        let status = a.wa.state.status;
        let label = a.wa.state.me?.id;
        const fn = (e: WAEvent) => {
          if (e.type === "state") {
            if (e.state.status === status && e.state.me?.id === label) return;
            status = e.state.status;
            label = e.state.me?.id;
          } else if (e.type !== "chats") return;
          if (accountsTimer) return;
          accountsTimer = setTimeout(() => {
            accountsTimer = null;
            send("accounts", {});
          }, 1500);
        };
        a.wa.bus.on("event", fn);
        return { bus: a.wa.bus, fn };
      });

      const ping = setInterval(() => send("ping", Date.now()), 25000);
      cleanup = () => {
        clearInterval(ping);
        if (accountsTimer) clearTimeout(accountsTimer);
        acct.wa.bus.off("event", onEvent);
        for (const s of subs) s.bus.off("event", s.fn);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
