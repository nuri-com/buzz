/**
 * Live chat over the relay socket.
 *
 * Open channels are readable and writable by any authenticated relay member
 * without an explicit join (relay `check_channel_membership`), so a freshly
 * registered Nuri passkey wallet can talk immediately.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { NostrEvent } from "@/shared/lib/nostr-client";
import { currentSignerPubkey } from "@/shared/lib/nostr-signer";
import { relayWsUrl } from "@/shared/lib/relay-url";
import { type RelayConnection, connectRelay } from "@/shared/lib/relay-socket";
import { type ChatChannel, toChannels } from "./channels";

export type { ChatChannel };

const KIND_GROUP_METADATA = 39000;
const KIND_STREAM_MESSAGE = 9;
const KIND_STREAM_MESSAGE_V2 = 40002;
const CHANNEL_LIMIT = 200;
const MESSAGE_LIMIT = 200;
const RECONNECT_DELAY_MS = 2_000;

function mergeMessage(messages: NostrEvent[], event: NostrEvent): NostrEvent[] {
  if (messages.some((existing) => existing.id === event.id)) return messages;
  return [...messages, event].sort((a, b) => a.created_at - b.created_at);
}

export function useChat() {
  const [connection, setConnection] = useState<RelayConnection | null>(null);
  const [channels, setChannels] = useState<ChatChannel[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<NostrEvent[]>([]);
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void currentSignerPubkey().then(setPubkey);
  }, []);

  useEffect(() => {
    let disposed = false;
    let relay: RelayConnection | null = null;

    const open = () => {
      relay = connectRelay(relayWsUrl(), {
        onOpen: () => {
          if (!disposed) setError("");
        },
        onClose: (reason) => {
          if (disposed) return;
          setConnection(null);
          if (reason) setError(reason);
          reconnectTimer.current = setTimeout(open, RECONNECT_DELAY_MS);
        },
      });
      setConnection(relay);
    };
    open();

    return () => {
      disposed = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      relay?.close();
    };
  }, []);

  // Channel discovery. kind:39000 is stored channel-scoped, so the relay only
  // returns the channels this member may see.
  useEffect(() => {
    if (!connection) return;
    const found: NostrEvent[] = [];
    return connection.subscribe(
      { kinds: [KIND_GROUP_METADATA], limit: CHANNEL_LIMIT },
      {
        onEvent: (event) => found.push(event),
        onEose: () => setChannels(toChannels(found)),
        onClosed: (reason) => setError(reason),
      },
    );
  }, [connection]);

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
  }, [connection, activeId]);

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
