export type WAStatus = "disconnected" | "connecting" | "qr" | "open";

export interface WAState {
  status: WAStatus;
  qr: string | null;
  pairingCode: string | null;
  me: { id: string; name: string | null } | null;
  lastError: string | null;
  sync: { active: boolean; progress: number | null; chats: number; messages: number; lastAt: number | null };
  media: { queued: number; active: number; failed: number };
}

export interface ChatItem {
  id: string;
  name: string;
  isGroup: boolean;
  unread: number;
  lastTs: number;
  archived: boolean;
  pinned: boolean;
  muted: boolean;
  last: {
    id: string;
    fromMe: boolean;
    type: string;
    text: string | null;
    status: number;
    isDeleted: boolean;
    senderName: string | null;
  } | null;
}

export interface Message {
  id: string;
  chatId: string;
  fromMe: boolean;
  senderJid: string | null;
  senderName: string | null;
  ts: number;
  type: string;
  text: string | null;
  media: null | {
    status: "none" | "pending" | "ready" | "failed";
    mime: string | null;
    size: number | null;
    seconds: number | null;
    width: number | null;
    height: number | null;
    fileName: string | null;
    thumbnail: string | null;
  };
  quoted: null | { id: string; text: string | null; sender: string | null };
  status: number;
  isDeleted: boolean;
  deletedAt: number | null;
  isEdited: boolean;
  removedFromPhone: boolean;
  editHistory: { text: string | null; ts: number }[];
  reactions: { emoji: string; count: number; mine: boolean }[];
}

export interface SessionUser {
  name: string | null;
  email: string | null;
  image: string | null;
}
