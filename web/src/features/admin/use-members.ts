/**
 * Relay membership administration (NIP-43 kinds 9030–9032).
 *
 * Permission matrix lives in the relay (`handlers/relay_admin.rs:6`):
 * add/remove need admin or owner, role changes need owner, and the owner role
 * itself can only be moved via the RELAY_OWNER_PUBKEY config. This module
 * publishes; the relay decides and answers `OK false` when it says no.
 */

import { useCallback, useEffect, useState } from "react";

import type { NostrEvent } from "@/shared/lib/nostr-client";
import type { RelayConnection } from "@/shared/lib/relay-socket";
import { type MemberRole, type RelayMember, toMembers } from "./members";

const KIND_MEMBERSHIP_LIST = 13534;
const KIND_ADD_MEMBER = 9030;
const KIND_REMOVE_MEMBER = 9031;
const KIND_CHANGE_ROLE = 9032;

export function useMembers(
  connection: RelayConnection | null,
  onError?: (reason: string) => void,
) {
  const [members, setMembers] = useState<RelayMember[] | null>(null);

  useEffect(() => {
    if (!connection) return;
    const found: NostrEvent[] = [];
    return connection.subscribe(
      { kinds: [KIND_MEMBERSHIP_LIST], limit: 5 },
      {
        onEvent: (event) => {
          found.push(event);
          setMembers(toMembers(found));
        },
        onEose: () => setMembers((current) => current ?? toMembers(found)),
        onClosed: (reason) => onError?.(reason),
      },
    );
  }, [connection, onError]);

  const addMember = useCallback(
    async (pubkey: string, role: Exclude<MemberRole, "owner">) => {
      if (!connection) throw new Error("Not connected to the relay");
      await connection.publish({
        kind: KIND_ADD_MEMBER,
        tags: [
          ["p", pubkey.trim().toLowerCase()],
          ["role", role],
        ],
        content: "",
      });
    },
    [connection],
  );

  const setRole = useCallback(
    async (pubkey: string, role: Exclude<MemberRole, "owner">) => {
      if (!connection) throw new Error("Not connected to the relay");
      await connection.publish({
        kind: KIND_CHANGE_ROLE,
        tags: [
          ["p", pubkey],
          ["role", role],
        ],
        content: "",
      });
    },
    [connection],
  );

  const removeMember = useCallback(
    async (pubkey: string) => {
      if (!connection) throw new Error("Not connected to the relay");
      await connection.publish({
        kind: KIND_REMOVE_MEMBER,
        tags: [["p", pubkey]],
        content: "",
      });
    },
    [connection],
  );

  return { members, addMember, setRole, removeMember };
}
