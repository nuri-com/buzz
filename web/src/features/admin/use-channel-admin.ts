/**
 * Channel administration over plain Nostr events.
 *
 * kind:9007 (create) and kind:9002 (edit metadata) are authorized by the relay
 * per kind against the signing pubkey. A non-owner gets `OK false` back — the
 * authority stays in the relay, this module only builds and publishes.
 */

import { useCallback } from "react";

import { useRelayConnection } from "@/shared/lib/use-relay-connection";
import type { ChannelVisibility } from "@/features/chat/channels";
import { useChannels } from "@/features/chat/use-channels";

const KIND_CREATE_GROUP = 9007;
const KIND_EDIT_METADATA = 9002;

export function useChannelAdmin() {
  const { connection, error, setError } = useRelayConnection();
  const channels = useChannels(connection, setError);

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

  return {
    channels,
    error,
    connected: connection !== null,
    createChannel,
    setVisibility,
  };
}
