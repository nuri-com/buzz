# Nuri Support Portal — `support.nuri.com`

Operational runbook for the Nuri fork's public support portal: what it is, how
it is deployed, how to administer it, and what is still broken.

**Last verified: 2026-07-28.**

---

## What it is

A public support chat. Anyone opens `https://support.nuri.com`, signs in with a
Nuri passkey, and lands directly in the chat to ask questions. The longer-term
goal is to run AI agents (local and VPS-hosted) in the same channels, and to
have both open and closed channels in one place.

Three routes, all behind the same passkey gate:

| Route | What it serves |
|-------|----------------|
| `/` | Chat — channel list, live timeline, composer |
| `/admin` | Channel + member administration |
| `/repos` | Git repository browser (the original web client) |

`https://support.nuri.com/inbox` still redirects to the separate
`cockpit.nuri.com` support dashboard. That is a different application and is
not part of this codebase.

---

## Architecture in one breath

```
Browser (web/)                       support.nuri.com
  │                                  ┌──────────────────────────┐
  │ 1. passkey → connect.nuri.com    │ Caddy                    │
  │ 2. derive Nostr key locally      │  /assets/*, /*  → static │
  │ 3. POST /api/nuri/register       │  /api/*, WS     → :3000  │
  │ 4. wss:// NIP-42 AUTH            │                          │
  │ 5. REQ (live) + EVENT (publish)  │ buzz-prod-relay-1 :3000  │
  └──────────────────────────────────┴──────────────────────────┘
```

The web client talks to the relay the same way every other Buzz client does:
NIP-42 authenticated WebSocket, `REQ` for reads, `EVENT` for writes. There are
no portal-specific HTTP endpoints beyond `POST /api/nuri/register`, which
pre-dates this work.

### Key client modules

| File | Responsibility |
|------|----------------|
| `web/src/shared/lib/relay-socket.ts` | Persistent NIP-42 socket: live `subscribe()`, `publish()` with `OK` confirmation |
| `web/src/shared/lib/use-relay-connection.ts` | One socket per mounted page, auto-reconnect after 2s |
| `web/src/features/chat/` | Channel discovery (kind:39000), live messages (kind:9/40002), send |
| `web/src/features/admin/` | Channel create/visibility, member roles, invite links |
| `web/src/features/nuri-wallet/` | Passkey → Connect → wallet derivation → relay registration |

`shared/lib/nostr-client.ts` (`queryEvents`) is the older one-shot helper — it
closes at `EOSE` and is still used by the repo browser. Chat and admin use
`relay-socket.ts` instead, because a chat needs the subscription left open.

---

## Deploying the web client

The relay runs as a Docker container; the web bundle is **static files served
by Caddy**, so a frontend deploy needs no relay restart.

```bash
cd web
pnpm check && pnpm typecheck && pnpm test:unit && pnpm build

rsync -az --delete -e ssh dist/ nuri-support:/opt/buzz-web-next/
ssh nuri-support 'set -e
  rm -rf /opt/buzz-web-backup-prev
  mv /opt/buzz-web /opt/buzz-web-backup-prev
  mv /opt/buzz-web-next /opt/buzz-web'

curl -s https://support.nuri.com/ | grep -o 'index-[A-Za-z0-9_-]*\.js'
```

The last line prints the live bundle hash — compare it with the hash `pnpm
build` reported. Rollback is `mv /opt/buzz-web-backup-prev /opt/buzz-web`.

**Route changes need a route-tree regeneration.** `web/src/app/routeTree.gen.ts`
is produced by the TanStack Vite plugin, and `pnpm build` runs `tsc` *before*
Vite — so adding a route makes `pnpm typecheck` fail against the stale tree.
Run `pnpm exec vite build` once to regenerate, then the normal gate passes.

### Server layout

| Path | What |
|------|------|
| `/opt/buzz-web` | Live web bundle (Caddy document root) |
| `/opt/buzz-web-backup-prev` | Previous bundle, for rollback |
| `/etc/caddy/Caddyfile` | TLS, WS upgrade, `/api/*` proxy, `/inbox` redirect |
| `/opt/buzz/deploy/compose/` | Relay compose project (`compose.yml`, `.env`, `run.sh`) |
| `/opt/buzz/deploy/compose/.env` | Relay configuration — see below |

SSH host alias `nuri-support` (`167.233.218.237`). **Authentication requires the
smartcard to be in the reader**; without it every SSH and rsync call fails with
`signing failed for ECDSA-SK … device not found`.

---

## Deploying the relay

The relay image is **not** built by this repo's CI. `buzz-prod-relay-1` runs
from a tag that reports as `ghcr.io/block/buzz:main` but contains Nuri-only code
(`POST /api/nuri/register` responds), so the build path was manual and is
currently **undocumented and unknown**.

> **Open item.** Any change under `crates/` cannot be shipped to
> support.nuri.com until this is resolved. Everything delivered in this session
> was deliberately confined to `web/` for that reason.

Restarting with changed configuration:

```bash
ssh nuri-support 'cd /opt/buzz/deploy/compose \
  && docker compose --env-file .env -f compose.yml up -d relay'
```

---

## Authorization model

Two independent layers. Confusing them costs an afternoon.

### 1. Relay membership — who may use the community at all

`relay_members.role` ∈ `owner` | `admin` | `member`, administered by signed
events. Permission matrix in `crates/buzz-relay/src/handlers/relay_admin.rs`:

| Kind | Operation | Required sender role |
|------|-----------|----------------------|
| 9030 | Add member | admin or owner — only **owner** may grant `admin` |
| 9031 | Remove member | admin (targets `member` only), owner (also admins) |
| 9032 | Change role | **owner only**, and never to `owner` |

Nobody can remove themselves or change their own role. The `owner` role cannot
be granted, moved, or removed by any event — **ownership changes only through
`RELAY_OWNER_PUBKEY` in `.env` plus a relay restart**, so a compromised admin
cannot lock the owner out. `bootstrap_owner` runs on every startup: it upserts
the configured pubkey as `owner` and demotes any other owner to `admin`, in one
transaction (`crates/buzz-db/src/relay_members.rs:320`).

Invite links (`POST /api/invites`, owner/admin only) grant `member`, never
`admin` — the role is hardcoded in `crates/buzz-relay/src/invite_token.rs:135`.
Promotion is a separate kind:9032 afterwards.

### 2. Channel membership — who may read and post where

`channel_members.role`, separate from the above.

- **Open channels (`visibility = 'open'`) are readable *and* writable by any
  authenticated relay member without joining** —
  `check_channel_membership` (`crates/buzz-relay/src/handlers/ingest.rs:518`)
  and `get_accessible_channel_ids` (`crates/buzz-db/src/channel.rs:638`). This
  is what makes the "log in and immediately ask a question" flow work with no
  relay changes at all.
- Private channels require explicit membership.
- kind:9002 metadata edits touching `name`/`about`/`archived`/`visibility`/`ttl`
  require `owner` or `admin` **in that channel**; `topic`/`purpose` allow any
  member.

---

## Administering the portal

Everything is in `/admin`, behind the passkey gate. Every action is a signed
Nostr event — the relay is the authority, and a rejection surfaces as a toast
with the relay's own message.

- **You are signing as** — your npub and hex. The browser signs with your
  *passkey-derived* key, which is a **different key from the one your desktop
  app holds**. The hex form is what `RELAY_OWNER_PUBKEY` expects.
- **Channels** — create (kind:9007), toggle open/private (kind:9002).
- **Members** — list, add by pubkey (kind:9030), promote/demote (kind:9032),
  remove (kind:9031), and mint an invite link.

Row actions are hidden only for your own row, never by the role the list
claims — see the stale-snapshot issue below.

### Rotating the owner

You need the target's hex pubkey. The friendly way to obtain it, without asking
anyone to copy 64 characters: have them log in, then read it from the relay log.

```bash
ssh nuri-support 'docker logs --since 5m buzz-prod-relay-1 2>&1 \
  | grep -i "auth successful" \
  | grep -oE "\"timestamp\":\"[^\"]+\"|\"pubkey\":\"[0-9a-f]{64}\"" | paste - -'
```

The relay logs every NIP-42 login at INFO (`handlers/auth.rs:277`). One login in
a narrow window is an unambiguous match. Confirm the npub back to the person
before acting — the relay is currently open, so strangers authenticate too.

Then:

```bash
ssh nuri-support 'cd /opt/buzz/deploy/compose
  cp .env .env.backup-$(date +%Y%m%d)
  sed -i "s/^RELAY_OWNER_PUBKEY=.*/RELAY_OWNER_PUBKEY=<hex>/" .env
  docker compose --env-file .env -f compose.yml up -d relay'
ssh nuri-support 'docker logs --since 2m buzz-prod-relay-1 | grep "owner bootstrapped"'
```

The previous owner is demoted to `admin`, not deleted. Remove them afterwards
from `/admin`.

---

## Known issues

Ranked by how much they will bite the next person.

### 1. The relay is open — membership is not enforced

`BUZZ_REQUIRE_RELAY_MEMBERSHIP=false` in `.env`. `check_relay_membership`
returns `OpenRelay` and admits **any Nostr key**
(`crates/buzz-relay/src/api/mod.rs:132`). The Nuri passkey registration writes a
`relay_members` row, but that row is never checked for access — so the passkey
is not actually an entry requirement, and unknown keys do show up in the member
list (five were observed on 2026-07-28).

Flipping it to `true` is one env var plus a restart; `RELAY_OWNER_PUBKEY` and
`BUZZ_RELAY_PRIVATE_KEY` are both set, so the preconditions hold, and
`/api/nuri/register` deliberately runs *before* the membership gate so passkey
signup keeps working. **Left at `false` by explicit decision on 2026-07-28** —
revisit before real users arrive.

### 2. Anyone may create channels

kind:9007 has **no authorization**: `validate_admin_event` returns `Ok(())` for
it before any check (`crates/buzz-relay/src/handlers/side_effects.rs:266`), and
the creator becomes owner of their channel. That is the right default for an
invite-gated team workspace and the wrong one for a public portal — an open
channel created by a stranger appears in everyone's list.

Fix is relay-side: gate kind:9007 on the relay role. Blocked on the relay build
path (see above). Note that `/admin` is not the exposure — any Nostr client can
send kind:9007 — but it does lower the bar to two clicks.

### 3. Membership list goes stale after an owner rotation

`/admin` renders the relay-signed kind:13534 snapshot. `bootstrap_owner` rotates
roles in a plain SQL transaction at startup and **never republishes that
snapshot**, so the list keeps showing the previous owner until some kind:9030 or
9031 triggers a republish.

Worked around in the client (row actions are hidden by identity, not by claimed
role, so you are never locked out of removing a demoted owner). The real fix is
one call to `publish_nip43_membership_list` after `bootstrap_owner` in
`crates/buzz-relay/src/main.rs:294` — again blocked on the relay build path.

### 4. Reload forces a new Connect round trip

`nostr-signer.ts` locks the key on `pagehide`, so every reload or tab restore
sends the user back through connect.nuri.com. Deliberate — no private key
touches any storage — but rough for a support chat where people switch tabs.
The candidate fix is holding *only* the Nostr key in `sessionStorage`, which is
a real security trade-off and needs a decision, not a patch.

### 5. The admin dashboard's own auth is a host-header check

Unrelated to `/admin`, but worth knowing: the separate read-only dashboard at
`/api/admin/v1` authorizes purely on the `Host` header matching
`BUZZ_ADMIN_HOST` (`crates/buzz-relay/src/api/admin/auth.rs:13`). No login, no
signature. Acceptable for a read-only reports board; **do not hang write
operations off it.** That is why portal administration went through signed
Nostr events instead.

---

## What is deliberately not built

Not bugs — scope decisions, listed so nobody re-discovers them as gaps.

- Profile names in the timeline (pubkeys are truncated; kind:0 lookup missing)
- Threads, reactions, edits, unread state, typing indicators
- Channel membership management for *private* channels from the web
- Agents in channels — the path exists (`buzz-acp` / `buzz-cli` with
  `BUZZ_PRIVATE_KEY`, no passkey needed), it simply has not been wired up yet
- Any Rust change at all, because the relay build path is unknown

---

## Verification

```bash
cd web
pnpm check        # biome + file sizes + pubkey truncation guard
pnpm typecheck
pnpm test:unit    # node:test, no infrastructure needed
pnpm build
```

Unit tests cover the pure logic that is easy to get silently wrong: channel
snapshot merging, membership snapshot parsing, the Connect return URL, and
wallet derivation. Everything socket- or React-shaped is currently unverified by
tests and was checked by hand against production.
