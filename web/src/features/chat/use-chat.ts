/**
 * Live chat over the relay socket.
 *
 * Open channels are readable and writable by any authenticated relay member
 * without an explicit join (relay `check_channel_membership`), so a freshly
 * registered Nuri passkey wallet can talk immediately.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import type { NostrEvent } from "@/shared/lib/nostr-client";
import { currentSignerPubkey } from "@/shared/lib/nostr-signer";
import { useRelayConnection } from "@/shared/lib/use-relay-connection";
import type { ChatChannel } from "./channels";
import { useChannels } from "./use-channels";

export type { ChatChannel };

const KIND_STREAM_MESSAGE = 9;
const KIND_STREAM_MESSAGE_V2 = 40002;
const MESSAGE_LIMIT = 200;

function mergeMessage(messages: NostrEvent[], event: NostrEvent): NostrEvent[] {
  if (messages.some((existing) => existing.id === event.id)) return messages;
  return [...messages, event].sort((a, b) => a.created_at - b.created_at);
}

export function useChat() {
  const { connection, error, setError } = useRelayConnection();
  const channels = useChannels(connection, setError);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<NostrEvent[]>([]);
  const [pubkey, setPubkey] = useState<string | null>(null);

  useEffect(() => {
    void currentSignerPubkey().then(setPubkey);
  }, []);

  useEffect(() => {
    if (activeId === null && channels && channels.length > 0) {
      setActiveId(channels[0].id);
    }
  }, [channels, activeId]);

  useEffect(() => {
    if (!connection || !activeId) return;
    setMessages([]);
    return connection.subscribe(
      {
        kinds: [KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2],
        "#h": [activeId],
        limit: MESSAGE_LIMIT,
      },
      {
        onEvent: (event) =>
          setMessages((current) => mergeMessage(current, event)),
        onClosed: (reason) => setError(reason),
      },
    );
  }, [connection, activeId, setError]);

  const send = useCallback(
    async (content: string) => {
      const text = content.trim();
      if (!connection || !activeId || !text) return;
      await connection.publish({
        kind: KIND_STREAM_MESSAGE,
        tags: [["h", activeId]],
        content: text,
      });
    },
    [connection, activeId],
  );

  const activeChannel = useMemo(
    () => channels?.find((channel) => channel.id === activeId) ?? null,
    [channels, activeId],
  );

  return {
    channels,
    activeChannel,
    selectChannel: setActiveId,
    messages,
    pubkey,
    error,
    connected: connection !== null,
    send,
  };
}
