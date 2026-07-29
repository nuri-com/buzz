import type { NostrEvent } from "@/shared/lib/nostr-client";

export type MemberRole = "owner" | "admin" | "member";

export type RelayMember = {
  pubkey: string;
  role: MemberRole;
};

const ROLE_ORDER: Record<MemberRole, number> = {
  owner: 0,
  admin: 1,
  member: 2,
};

function isRole(value: string): value is MemberRole {
  return value === "owner" || value === "admin" || value === "member";
}

/**
 * Relay members from the newest kind:13534 snapshot.
 *
 * Tags are `["member", <pubkey hex>, <role>]` — the relay signs and replaces
 * the whole list on every membership change, so only the newest event counts.
 */
export function toMembers(events: NostrEvent[]): RelayMember[] {
  const newest = events.reduce<NostrEvent | null>(
    (best, event) =>
      best === null || best.created_at < event.created_at ? event : best,
    null,
  );
  if (!newest) return [];

  const members: RelayMember[] = [];
  for (const tag of newest.tags) {
    if (tag[0] !== "member" || !tag[1] || !tag[2]) continue;
    if (!isRole(tag[2])) continue;
    members.push({ pubkey: tag[1], role: tag[2] });
  }
  return members.sort(
    (a, b) =>
      ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
      a.pubkey.localeCompare(b.pubkey),
  );
}

export function isPubkeyHex(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value.trim());
}
