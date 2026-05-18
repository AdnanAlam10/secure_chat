# secure_chat

A private, self-destructing 1-on-1 chat room with **end-to-end encryption**. The server stores ciphertext only — even with full database access, an attacker cannot read messages.

https://github.com/user-attachments/assets/1430f706-a876-4047-be1e-63019b24b5ef

**Live demo:** [secure-chat-liart.vercel.app](https://secure-chat-liart.vercel.app/)

## Highlights

- **End-to-end encryption** with AES-GCM 256. Keys are generated in the browser and shared via the URL fragment (`/room/{id}#k=...`), which browsers never send to servers.
- **Self-destructing rooms** — 10-minute TTL, plus a manual "destroy now" button that wipes Redis and broadcasts a destroy event over realtime.
- **Race-safe 2-user cap** — atomic join via a Lua script on Redis (`EVAL`), so two simultaneous joiners can't both bypass the check.
- **Rate limiting** — sliding-window per IP via Upstash Ratelimit, on `/messages` and `/room/create`.
- **Strict security headers** — CSP with `connect-src 'self'` blocks key exfiltration even if XSS occurs; HSTS, no-referrer, frame-ancestors none.
- **Tested** — Vitest suite covers the crypto roundtrip, AES tamper detection, auth middleware, and URL fragment parsing.

## Architecture

```
┌─────────┐                ┌────────────┐               ┌─────────┐
│ Browser │ ── ciphertext─▶│   Next.js  │── REST/Lua ──▶│  Redis  │
│         │ ◀── ciphertext─│   + Elysia │◀──            │(Upstash)│
└─────────┘                └────────────┘               └─────────┘
     │                            ▲
     │                            │
     └─── realtime (SSE) ─────────┘
       via Upstash Realtime
```

- **Frontend:** Next.js 16 (App Router) + React 19 with the React Compiler, Tailwind v4, TanStack Query.
- **Backend:** Elysia mounted inside a Next.js route handler at `/api/[[...slugs]]`. End-to-end types to the client via `@elysiajs/eden`.
- **Storage:** Upstash Redis. Per room: a `meta:{id}` hash (members + `expiresAt`) and a `messages:{id}` list. All three keys share a TTL.
- **Realtime:** Upstash Realtime over an SSE endpoint at `/api/realtime`. Used for live message fan-out and the destroy broadcast.
- **Auth:** httpOnly `x-auth-token` cookie issued by the Next.js proxy (middleware). The proxy enforces the 2-user cap atomically via Redis `EVAL`.

## Threat model

| Capability                                            | Attacker can read messages?                                                                                                                           |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full Redis dump / compromised server / malicious host | **No.** Ciphertext only.                                                                                                                              |
| Passive network MITM (between client and server)      | **No.** Ciphertext only.                                                                                                                              |
| Active MITM serving modified app code                 | Yes — they own the client.                                                                                                                            |
| User shares the full URL (including `#k=...`)         | Yes — the key is the secret.                                                                                                                          |
| XSS injection on the chat app                         | Mitigated by strict CSP `connect-src 'self'`: injected script can read the key from `location.hash` but cannot exfiltrate it to a third-party domain. |

**What the server sees:** sender display name, message timestamps, ciphertext blob, IV, room ID, and which (opaque) session tokens are in which room.

**What the server never sees:** plaintext messages or the symmetric key.

## How E2E works

1. On "CREATE SECURE ROOM," the browser runs `crypto.subtle.generateKey({ name: "AES-GCM", length: 256 })`, exports the raw key, and base64url-encodes it.
2. The browser navigates to `/room/{id}#k={key}`. The URL fragment is **never sent in HTTP requests** (per RFC 3986), so the server never receives the key.
3. To share the room, copy the full URL. The receiving browser reads `location.hash`, imports the key, and joins.
4. On send: the client encrypts with a fresh 12-byte IV → `POST /messages` with `{sender, ciphertext, iv}`.
5. On receive: realtime triggers a refetch; the client decrypts each message client-side, caching by id.
6. If a user lands on a room URL without `#k=...`, they're redirected to the lobby with a "no encryption key" error.

See [`src/lib/crypto.ts`](src/lib/crypto.ts).

## Notable engineering choices

**Atomic room join via Lua.** The 2-user cap could be bypassed by two concurrent joiners both passing the check before either writes back. The proxy runs an `EVAL` script that performs the check-then-add inside Redis, eliminating the race. See [`src/proxy.ts`](src/proxy.ts).

**Wall-clock countdown.** The self-destruct timer reads an `expiresAt` timestamp once and recomputes `(expiresAt - Date.now()) / 1000` each tick, instead of decrementing a counter. This avoids drift when the tab sleeps. See [`src/app/room/[roomId]/page.tsx`](src/app/room/[roomId]/page.tsx).

**Elysia in a Next.js route handler.** End-to-end types via `treaty<App>` give the client compile-time guarantees on the API surface, with Zod runtime validation on bodies and queries. Auth is implemented as a scoped Elysia plugin with a typed `AuthError`.

**CSP that matches the threat model.** The README's threat model claims "XSS doesn't leak the key" — the matching mitigation is `connect-src 'self'` in `next.config.ts`, plus `frame-ancestors 'none'`, HSTS, and a no-referrer policy.

## Running locally

```bash
# 1. install
npm install

# 2. env (Upstash Redis with Realtime enabled)
cp .env.example .env
# edit .env and fill in:
#   UPSTASH_REDIS_REST_URL=...
#   UPSTASH_REDIS_REST_TOKEN=...

# 3. dev server
npm run dev          # http://localhost:3000

# 4. tests
npm test
```

## Tests

- `src/lib/crypto.test.ts` — encrypt/decrypt roundtrip, fresh-IV-per-message, wrong-key reject, ciphertext-tamper reject, unicode payloads, URL-fragment parsing.
- `src/app/api/[[...slugs]]/auth.test.ts` — missing cookie/query → 401, unknown token → 401, valid token → 200 with auth context.

```bash
npm test           # one-shot
npm run test:watch # watch mode
```

## What I would add next

- **Server-Sent Events presence channel** so each client sees a live "1/2 connected" indicator.
- **PBKDF2-derived keys from a passphrase**, as an alternative to URL-fragment key sharing for users who can't easily share a long URL.
- **Encrypted file attachments** (same AES-GCM key, blob upload to an object store of ciphertext only).
- **CSP nonces** via the proxy file, so we can drop `script-src 'unsafe-inline'`. Next.js' inline streaming scripts are the blocker right now.

## Tech stack

Next.js 16 · React 19 + React Compiler · Elysia · Upstash Redis · Upstash Realtime · TanStack Query · WebCrypto · Tailwind v4 · Vitest · TypeScript

## License

MIT
