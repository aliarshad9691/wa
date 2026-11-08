export function mediaUrl(chatId: string, id: string, download = false) {
  return `/api/media/${encodeURIComponent(chatId)}/${encodeURIComponent(id)}${download ? "?download=1" : ""}`;
}

export function timeOf(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function chatListTime(ts: number) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const today = startOfDay(new Date());
  const day = startOfDay(d);
  if (day === today) return timeOf(ts);
  if (day === today - 86400000) return "Yesterday";
  if (today - day < 6 * 86400000) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString();
}

export function dayLabel(ts: number) {
  const d = new Date(ts * 1000);
  const today = startOfDay(new Date());
  const day = startOfDay(d);
  if (day === today) return "Today";
  if (day === today - 86400000) return "Yesterday";
  if (today - day < 6 * 86400000) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
}

export function formatBytes(n: number | null | undefined) {
  if (!n) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function formatDuration(s: number | null | undefined) {
  const t = Math.max(0, Math.round(s || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

const SENDER_COLORS = ["#e542a3", "#1f7aec", "#c25a00", "#00a884", "#7f66ff", "#d6336c", "#2a9d8f", "#a855f7", "#0891b2", "#b45309"];
export function colorFor(key: string | null | undefined) {
  if (!key) return SENDER_COLORS[0];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return SENDER_COLORS[Math.abs(h) % SENDER_COLORS.length];
}

export function previewText(type: string, text: string | null) {
  switch (type) {
    case "image":
      return "📷 " + (text || "Photo");
    case "video":
      return "🎥 " + (text || "Video");
    case "audio":
      return "🎵 Audio";
    case "ptt":
      return "🎤 Voice message";
    case "document":
      return "📄 " + (text || "Document");
    case "sticker":
      return "Sticker";
    case "location":
      return "📍 Location";
    case "contact":
      return "👤 " + (text || "Contact");
    case "poll":
      return text?.split("\n")[0] || "📊 Poll";
    default:
      return text || "";
  }
}

export function phoneOf(jid: string) {
  const u = jid.split("@")[0];
  return /^\d+$/.test(u) ? "+" + u : u;
}
