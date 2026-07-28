# Session Log

## 2026-07-28 — Chat für alle Passkey-User auf support.nuri.com

**Goal:** Jeder soll sich auf support.nuri.com mit Passkey einloggen und direkt
im Chat mitreden können. Emin sah stattdessen dauerhaft "This community is
empty".

**Decisions:**

1. Der Passkey-Login war nie kaputt. `NuriWalletGate` rendert seine Kinder erst
   nach Connect-Approval + Passkey-Unlock + `POST /api/nuri/register` — der
   Screenshot war der Erfolgsfall. Der Web-Client hatte schlicht keinen Chat:
   Routen waren nur Repo-Browser und Invite. Diagnose ohne Live-Test, per Probe
   gegen den deployten Relay (`/api/nuri/register` → 401 = Handler existiert).
2. Keine Relay-Änderung für den Chat. `check_channel_membership`
   (`crates/buzz-relay/src/handlers/ingest.rs:518`) erlaubt jedem
   authentifizierten Relay-Mitglied Lesen **und** Schreiben in Channels mit
   `visibility = 'open'`, ganz ohne Join. Genau die Semantik, die "jeder darf
   Fragen stellen" braucht.
3. Neuer persistenter Socket (`shared/lib/relay-socket.ts`) statt Ausbau von
   `queryEvents` — das ist One-Shot und schließt bei EOSE. Chat braucht das
   offene Abo plus einen Publish-Pfad mit `OK`-Bestätigung.
4. Chat liegt auf `/`, Repo-Browser auf `/repos`. Beide hinter dem Passkey-Gate.
5. Channel-Admin (Emin wollte Web statt CLI) **nicht** an das bestehende
   Admin-Dashboard gehängt. Dessen einzige Autorisierung ist ein
   Host-Header-Vergleich gegen `BUZZ_ADMIN_HOST`
   (`crates/buzz-relay/src/api/admin/auth.rs:13`) — kein Login, keine Signatur.
   Für ein read-only Reports-Board vertretbar, für Schreiboperationen ein Loch.
   Stattdessen `/admin` im Web-Client, das kind:9007 (create) und kind:9002
   (`["visibility", …]`) publisht. Die Autorisierung macht der Relay pro Kind
   gegen den signierenden Pubkey; ein Nicht-Owner bekommt `OK false`. Kein neuer
   Endpoint, kein zweiter Auth-Pfad.
6. Bugfix im eigenen Code aus 1: der Chat filterte alle `private`-Channels weg.
   Falsch — kind:39000 wird channel-scoped gespeichert, ein privater Channel in
   der Relay-Antwort ist einer, in dem das Mitglied drin ist. Jetzt wird nur
   `hidden` (DMs) gefiltert.

**State:** Commits `09f4dda2` und `fbf3990b` auf `feat/nuri-passkey-wallet`.
`pnpm check`, `typecheck`, `test:unit`, `build` grün. Live deployed auf
support.nuri.com (statisches Bundle in `/opt/buzz-web`, Caddy davor, Relay
unverändert als `buzz-prod-relay-1`). Backup des vorherigen Bundles liegt unter
`/opt/buzz-web-backup-prev`, Rollback ist ein `mv`. Emin hat den Chat getestet:
funktioniert, aktuell existiert nur der Channel `general`.

**Next steps:**

1. Reload-Verhalten entscheiden: `nostr-signer.ts` löscht den Key bei
   `pagehide`, jeder Reload erzwingt eine neue Connect-Runde über
   connect.nuri.com. Für einen Support-Chat der nächste harte Punkt. Fix wäre,
   nur den Nostr-Key (nicht die Wallet-Keys) in `sessionStorage` zu halten —
   bewusster Sicherheits-Tradeoff, deshalb offen.
2. Agenten (lokal + VPS) in den Support-Channel: läuft über den bestehenden
   `buzz-acp`/`buzz-cli`-Pfad mit `BUZZ_PRIVATE_KEY`, kein Passkey nötig.
3. Profilnamen statt gekürzter Pubkeys in der Timeline (kind:0).
4. Threads, Reaktionen, Unread-State — bewusst nicht im ersten Schritt.

**Open questions:**

1. Soll der Nostr-Key den Reload überleben (Punkt 1 oben)?
2. Sollen Support-User private Channels überhaupt in der Liste sehen, wenn sie
   Mitglied sind, oder braucht der Support-Chat eine engere Ansicht?
