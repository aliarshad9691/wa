import { requireUser } from "@/lib/session";
import { wa, type WAEvent } from "@/lib/wa/manager";
import { getMessage, toDTO } from "@/lib/wa/repo";

export const dynamic = "force-dynamic";

/** Server-sent events: connection state, new/updated messages, chat list changes. */
export async function GET(req: Request) {
  const { deny } = await requireUser();
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
      send("state", wa.state);
      const onEvent = (e: WAEvent) => {
        if (e.type === "state") send("state", e.state);
        else if (e.type === "chats") send("chats", {});
        else if (e.type === "history") send("history", { chatIds: e.chatIds });
        else if (e.type === "message") {
          const row = getMessage(e.chatId, e.messageId);
          if (row) send("message", { isNew: e.isNew, message: toDTO(row) });
        }
      };
      wa.bus.on("event", onEvent);
      const ping = setInterval(() => send("ping", Date.now()), 25000);
      cleanup = () => {
        clearInterval(ping);
        wa.bus.off("event", onEvent);
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
