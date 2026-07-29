# Session Log

## 2026-07-28 — Support-Portal auf support.nuri.com: Chat, Admin, Owner-Rotation

**Goal:** Jeder soll sich auf support.nuri.com mit Passkey einloggen und direkt
im Chat Fragen stellen können. Später zusätzlich AI-Agenten (lokal und VPS) in
denselben Channels, und offene wie geschlossene Channels an einem Ort. Emin sah
stattdessen nach jedem Login "This community is empty".

Operativer Runbook mit allen Dateiverweisen:
[docs/nuri-support-portal.md](docs/nuri-support-portal.md).

### Decisions

1. **Der Passkey-Login war nie kaputt.** `NuriWalletGate` rendert seine Kinder
   erst nach Connect-Approval, Passkey-Unlock und `POST /api/nuri/register` —
   der Screenshot war der Erfolgsfall. Der Web-Client hatte schlicht keinen
   Chat: die Routen waren nur Repo-Browser und Invite. Diagnose ohne Live-Test,
   per Probe gegen den deployten Relay (`/api/nuri/register` → 401 heißt: der
   Handler existiert und verlangt nur eine Signatur).
2. **Keine Relay-Änderung für den Chat nötig.** `check_channel_membership`
   (`crates/buzz-relay/src/handlers/ingest.rs:518`) erlaubt jedem
   authentifizierten Relay-Mitglied Lesen *und* Schreiben in Channels mit
   `visibility = 'open'`, ganz ohne Join. Genau die Semantik, die "jeder darf
   sofort fragen" braucht.
3. **Neuer persistenter Socket** (`web/src/shared/lib/relay-socket.ts`) statt
   Ausbau von `queryEvents` — das ist One-Shot und schließt bei `EOSE`. Chat
   braucht das offene Abo plus einen Publish-Pfad mit `OK`-Bestätigung.
4. **Channel-Admin nicht an das bestehende Admin-Dashboard gehängt.** Dessen
   einzige Autorisierung ist ein Host-Header-Vergleich gegen `BUZZ_ADMIN_HOST`
   (`crates/buzz-relay/src/api/admin/auth.rs:13`) — kein Login, keine Signatur.
   Für ein read-only Reports-Board vertretbar, für Schreiboperationen ein Loch.
   Stattdessen `/admin` im Web-Client, das kind:9007/9002 publisht; der Relay
   autorisiert pro Kind.
5. **Rollensystem war bereits vollständig da.** `relay_members` mit
   owner/admin/member, kind:9030/9031/9032 mit Permission-Matrix in
   `handlers/relay_admin.rs`. Nichts zu erfinden — nur ein UI darüber.
6. **Ownership nur über Config.** `RELAY_OWNER_PUBKEY` plus Neustart;
   `bootstrap_owner` setzt den neuen Owner und stuft alte Owner in derselben
   Transaktion auf `admin` herunter. Bewusst so, damit ein kompromittierter
   Admin den Owner nicht aussperren kann.
7. **Owner rotiert, ohne dass Emin 64 Zeichen kopieren musste.** Der Relay
   loggt jeden NIP-42-Login mit Pubkey auf INFO (`handlers/auth.rs:277`). Emin
   loggte sich ein, genau ein Login im Zeitfenster, Zuordnung eindeutig, npub
   zur Bestätigung zurückgespiegelt.

### Gefundene Probleme, die vorher niemand auf dem Schirm hatte

8. **Der Relay steht offen.** `BUZZ_REQUIRE_RELAY_MEMBERSHIP=false` in prod;
   `check_relay_membership` gibt `OpenRelay` zurück und lässt jeden Nostr-Key
   durch (`crates/buzz-relay/src/api/mod.rs:132`). Die Passkey-Registrierung
   schreibt zwar eine `relay_members`-Zeile, die aber für den Zugang nie
   geprüft wird. Fünf fremde Keys waren am 2026-07-28 in der Mitgliederliste.
   Die README behauptete das Gegenteil — korrigiert.
9. **kind:9007 hat gar keine Autorisierung.** `validate_admin_event` gibt für
   Channel-Anlegen sofort `Ok(())` zurück
   (`handlers/side_effects.rs:266`). Jedes Mitglied darf Channels anlegen und
   wird deren Owner. Für einen Team-Workspace der richtige Default, für ein
   öffentliches Portal der falsche.
10. **Mitgliederliste veraltet nach Owner-Rotation.** `bootstrap_owner` läuft
    als reine SQL-Transaktion beim Start und publiziert den kind:13534-Snapshot
    nicht neu, den der Client rendert.

### Fehler, die ich selbst gebaut und wieder eingesammelt habe

11. Chat filterte alle als `private` markierten Channels weg. Falsch —
    kind:39000 wird channel-scoped gespeichert, ein privater Channel in der
    Antwort ist einer, in dem das Mitglied drin ist. Jetzt nur noch `hidden`.
12. Behauptet, ein Nicht-Owner bekomme bei allen `/admin`-Aktionen `OK false`.
    Stimmte für kind:9002, nicht für kind:9007 — siehe Punkt 9. Korrigiert,
    nachdem Emin nachfragte.
13. Row-Actions in der Mitgliederliste nach der Rolle aus dem Snapshot
    ausgeblendet. Zusammen mit Punkt 10 eine Sackgasse: ausgerechnet die Zeile
    des bereits entmachteten Alt-Owners hatte keinen Remove-Button. Jetzt wird
    nur die eigene Zeile ausgeblendet, identifiziert über den Signaturschlüssel.

### State

Sieben Commits auf `feat/nuri-passkey-wallet`, alle deployed:

| Commit | Inhalt |
|--------|--------|
| `09f4dda2` | Chat auf `/`, Repo-Browser auf `/repos`, `relay-socket.ts` |
| `fbf3990b` | `/admin` Channel-Verwaltung, private-Filter-Bugfix |
| `4d5f0580` | Mitglieder + Invite-Links in `/admin` |
| `dd936037` | Signatur-Identität auf `/admin` sichtbar |
| `ef994d46` | Connect-Rücksprung behält den Pfad |
| `323996de` | WebAuthn-Fokus + veralteter Snapshot |
| `cfd4d582` | Session-Log |

`pnpm check`, `typecheck`, `test:unit` (12 Tests) und `build` grün. Live auf
support.nuri.com als `index-PQCgW_DB.js`. Backup des vorherigen Bundles unter
`/opt/buzz-web-backup-prev`, Rollback ist ein `mv`.

Owner ist jetzt `9eb9d804…1e5c` (`npub1n6uaspx…ee9v0g`), Emins
Passkey-Identität. Der vorherige Owner `99b4556a…a801` wurde beim Neustart
automatisch auf `admin` heruntergestuft — Backup der alten Relay-Config unter
`/opt/buzz/deploy/compose/.env.backup-20260728-owner`.

### Next steps

1. **Alt-Owner `99b4556a…a801` in `/admin` entfernen.** Der Button ist seit
   `323996de` da. Das löst zugleich einen frischen kind:13534-Snapshot aus und
   räumt die falsche Anzeige aus Punkt 10 auf. War beim Session-Ende noch nicht
   bestätigt.
2. **Relay-Build-Pfad klären.** `buzz-prod-relay-1` läuft als
   `ghcr.io/block/buzz:main`, enthält aber Nuri-Code — der Build war manuell und
   ist undokumentiert. **Solange das offen ist, kann keine einzige
   Rust-Änderung nach prod.** Deshalb blieb diese Session komplett in `web/`.
   Das ist der wichtigste nächste Schritt, er blockiert drei andere.
3. **`BUZZ_REQUIRE_RELAY_MEMBERSHIP=true`** entscheiden (Punkt 8). Ein Env-Flag
   plus Neustart, Voraussetzungen sind erfüllt. Emin hat am 2026-07-28
   ausdrücklich "offen lassen" gewählt — vor echten Nutzern neu bewerten.
4. **kind:9007 an die Relay-Rolle binden** (Punkt 9). Blockiert auf 2.
5. **`publish_nip43_membership_list` nach `bootstrap_owner`** in
   `crates/buzz-relay/src/main.rs:294` (Punkt 10). Blockiert auf 2.
6. **Agenten in die Channels.** Läuft über `buzz-acp` / `buzz-cli` mit
   `BUZZ_PRIVATE_KEY`, kein Passkey nötig. Nichts zu bauen, nur zu verdrahten.
7. **Reload-Verhalten entscheiden.** `nostr-signer.ts` löscht den Key bei
   `pagehide`, jeder Reload erzwingt eine neue Connect-Runde. Kandidat: nur den
   Nostr-Key in `sessionStorage`. Echter Sicherheits-Trade-off, braucht eine
   Entscheidung statt eines Patches.
8. **Profilnamen statt gekürzter Pubkeys** in der Timeline (kind:0).

### Open questions

1. Emin sagte "alles alte kann weg" — bezog sich das nur auf
   Rückwärtskompatibilität, oder soll die Datenbank tatsächlich geleert werden?
   Nicht beantwortet, deshalb nichts gelöscht.
2. Sollen Support-User private Channels sehen, in denen sie Mitglied sind, oder
   braucht das Portal eine engere Ansicht als der Desktop?
3. Wem gehört der alte Master Key `99b4556a…a801`? Er hat sich in sechs Stunden
   Log kein einziges Mal verbunden. Vermutlich der Desktop-Key aus dem
   ursprünglichen Setup, nie bestätigt.
