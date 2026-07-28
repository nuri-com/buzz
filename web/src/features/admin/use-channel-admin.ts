/**
 * Channel administration over plain Nostr events.
 *
 * kind:9002 (edit metadata) is authorized by the relay against the actor's
 * channel role. kind:9007 (create) currently is NOT — `validate_admin_event`
 * returns early for it (`side_effects.rs:266`), so any relay member may create
 * a channel and becomes its owner. Restricting that is a relay-side change.
 */

import { useCallback } from "react";

import type { RelayConnection } from "@/shared/lib/relay-socket";
import type { ChannelVisibility } from "@/features/chat/channels";
import { useChannels } from "@/features/chat/use-channels";

const KIND_CREATE_GROUP = 9007;
const KIND_EDIT_METADATA = 9002;

export function useChannelAdmin(
  connection: RelayConnection | null,
  onError: (reason: string) => void,
) {
  const channels = useChannels(connection, onError);

  const createChannel = useCallback(
    async (input: {
      name: string;
      about: string;
      visibility: ChannelVisibility;
    }) => {
      if (!connection) throw new Error("Not connected to the relay");
      const tags = [
        ["h", crypto.randomUUID()],
        ["name", input.name.trim()],
        ["visibility", input.visibility],
        ["channel_type", "stream"],
      ];
      if (input.about.trim()) tags.push(["about", input.about.trim()]);
      await connection.publish({ kind: KIND_CREATE_GROUP, tags, content: "" });
    },
    [connection],
  );

  const setVisibility = useCallback(
    async (channelId: string, visibility: ChannelVisibility) => {
      if (!connection) throw new Error("Not connected to the relay");
      await connection.publish({
        kind: KIND_EDIT_METADATA,
        tags: [
          ["h", channelId],
          ["visibility", visibility],
        ],
        content: "",
      });
    },
    [connection],
  );

  return { channels, createChannel, setVisibility };
}
