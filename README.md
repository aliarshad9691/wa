# Chat Mirror — self-hosted WhatsApp Web–style client

A Next.js app that links to your phone like WhatsApp Web, mirrors your chats, and **keeps every
message, including ones deleted for everyone**.

- **Login**: Google only (Auth.js), limited to `ALLOWED_EMAILS`.
- **Linking**: Settings → *Linked phone* → scan the QR code, or link with a phone-number pairing code.
- **Sync**: full history sync when you link, then live updates. *Load older messages from phone* in a chat asks the phone for more.
- **Storage**: messages, chats and contacts go in **SQLite** (`data/app.db`). Media (photos, videos, voice notes, audio, documents, stickers) goes in **S3** (or R2, MinIO and other S3-compatible services).
- **Send**: text, photos, videos, audio files, documents, and voice notes recorded in the browser (converted to OGG/Opus with ffmpeg). Also replies and reactions.
- **Deleted messages are never removed**: when a message is deleted for everyone, its bubble stays with its content (text or media), gets a red highlight and a *Deleted by sender · time* label. The chat list has a **Deleted** filter that lists every deleted message, and each chat has a *Deleted only* toggle.
- **Edits keep history**: edited messages show *Edited*, and you can view their earlier versions.
- WhatsApp Web–style layout: chat list on the left, conversation on the right, light and dark themes, works at phone width.

## Requirements

- Node.js 20+ (tested on 22)
- `ffmpeg` and `ffprobe` on `PATH`, used for voice notes and video thumbnails
- A **long-running Node server**. The WhatsApp connection is a persistent socket, so this cannot run on serverless platforms (Vercel functions, Lambda). A VPS, Docker host, Fly.io, Railway or a home server all work.

## Setup

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

1. **`AUTH_SECRET`**: generate one with `npx auth secret`.
2. **Google OAuth**: in Google Cloud Console, open *APIs & Services → Credentials → Create OAuth client ID (Web)*.
   - Authorized redirect URI: `http://localhost:3000/api/auth/callback/google` (plus your production URL).
   - Put the values in `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.
3. **`ALLOWED_EMAILS`**: a comma-separated list of the Google accounts allowed in. Every other account is rejected.
4. **S3**: set `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`. For R2 or MinIO, also set `S3_ENDPOINT` (and `S3_FORCE_PATH_STYLE=true` for MinIO). The IAM user needs `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` and `s3:ListBucket` on the bucket. Keep the bucket **private**: the app serves media through short-lived presigned URLs, and only after checking your session.
   If `S3_BUCKET` is empty, media is written to `data/media/` on local disk. Use that for development only.

Then run:

```bash
npm run dev          # development
npm run build && npm start   # production
```

Open the app, sign in, and *Settings* opens with a QR code. On your phone, go to **WhatsApp → Settings → Linked devices → Link a device** and scan it. History starts syncing right away. Media is copied to S3 in the background; the queue is shown in Settings.

## How it works

| Piece | File |
| --- | --- |
| WhatsApp connection, history sync, live events, media → S3 queue, sending | `src/lib/wa/manager.ts` (uses [Baileys](https://github.com/WhiskeySockets/Baileys)) |
| Message parsing (text/media/revoke/edit/reaction) | `src/lib/wa/parse.ts` |
| SQLite persistence; the "never delete" rules | `src/lib/wa/repo.ts`, `src/lib/db.ts` |
| S3 / local media storage + presigned URLs | `src/lib/storage.ts` |
| Auth (Google), route protection | `src/auth.ts`, `src/proxy.ts`, `src/lib/session.ts` |
| Realtime to the browser (Server-Sent Events) | `src/app/api/events/route.ts` |
| UI | `src/components/*` |

How a deletion is handled: WhatsApp sends a *revoke* protocol message, which Baileys also reports as an update with `message: null`. The app handles both by setting `is_deleted = 1` and `deleted_at` on the stored row and **never touches the content or the S3 object**. Media is downloaded the moment a message arrives, so it is usually saved before anyone can delete it. If a deletion arrives for a message the app never saw (for example, one sent while the server was offline and deleted before sync), a placeholder row records that something was deleted.

The WhatsApp session keys live in `data/wa-auth/`. Back up `data/` (it holds the SQLite database and the session) and protect it like a password.

## Notes and limitations

- This uses an **unofficial** WhatsApp Web protocol library. It's widely used, but WhatsApp could change things or restrict accounts that use unofficial clients. Use it with your own account, at your own risk.
- WhatsApp currently rejects the "Desktop" companion identity (HTTP 428), so the app links as a desktop **Chrome** browser and still requests a full history sync. How much history the phone sends is up to the phone. Use *Load older messages from phone* for more. You can override the identity with `WA_BROWSER`.
- One linked WhatsApp account per deployment. Every allowed login sees the same account.
- Deleting a message from this app, calls, status/stories and channels are not implemented.
- Switching the media backend (local ↔ S3) does not move media that's already stored.

## Development helper

`POST /api/dev/simulate` (only when `NODE_ENV` is not `production`, and only for signed-in users) pushes synthetic WhatsApp messages through the real ingest pipeline. That lets you test the UI and the deleted/edited handling without a phone. Sample media is in `dev-fixtures/`. See the comment at the top of the route for the payloads.
