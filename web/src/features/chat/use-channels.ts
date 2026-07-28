import { useEffect, useState } from "react";

import type { NostrEvent } from "@/shared/lib/nostr-client";
import type { RelayConnection } from "@/shared/lib/relay-socket";
import { type ChatChannel, toChannels } from "./channels";

const KIND_GROUP_METADATA = 39000;
const CHANNEL_LIMIT = 200;

/**
 * Channels this member may see, from kind:39000 discovery.
 *
 * `null` while the first EOSE is still outstanding — an empty array means the
 * relay genuinely returned nothing, which the UI must say out loud.
 */
export function useChannels(
  connection: RelayConnection | null,
  onError?: (reason: string) => void,
): ChatChannel[] | null {
  const [channels, setChannels] = useState<ChatChannel[] | null>(null);

  useEffect(() => {
    if (!connection) return;
    const found: NostrEvent[] = [];
    return connection.subscribe(
      { kinds: [KIND_GROUP_METADATA], limit: CHANNEL_LIMIT },
      {
        onEvent: (event) => {
          found.push(event);
          // Discovery events also arrive live after channel edits.
          setChannels((current) =>
            current === null ? current : toChannels(found),
          );
        },
        onEose: () => setChannels(toChannels(found)),
        onClosed: (reason) => onError?.(reason),
      },
    );
  }, [connection, onError]);

  return channels;
}
