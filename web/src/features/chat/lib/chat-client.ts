import {
  type NostrEvent,
  publishEvent,
  queryEvents,
  subscribeEvents,
} from "@/shared/lib/nostr-client";
import { getBrowserPublicKey, signNostrEvent } from "@/shared/lib/nostr-signer";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  type ChatChannel,
  includeBootstrapGeneralChannel,
  mergeChatMessages,
  projectChatChannels,
  selectAutoJoinChannel,
} from "./chat";

const CHANNEL_QUERY_LIMIT = 500;
const MESSAGE_QUERY_LIMIT = 100;
const MAX_MESSAGE_LENGTH = 60_000;
const CHAT_MESSAGE_KINDS = [9, 40002];

async function queryChannelCatalog(
  wsUrl: string,
  pubkey: string,
): Promise<ChatChannel[]> {
  const [memberships, metadata] = await Promise.all([
    queryEvents(wsUrl, {
      kinds: [39002],
      "#p": [pubkey],
      limit: CHANNEL_QUERY_LIMIT,
    }),
    queryEvents(wsUrl, { kinds: [39000], limit: CHANNEL_QUERY_LIMIT }),
  ]);
  return projectChatChannels(memberships, metadata);
}

export type ChatCatalog = {
  pubkey: string;
  channels: ChatChannel[];
};

export async function loadChatCatalog(
  wsUrl = relayWsUrl(),
  bootstrapGeneralChannelId?: string,
): Promise<ChatCatalog> {
  const pubkey = await getBrowserPublicKey();
  let channels = includeBootstrapGeneralChannel(
    await queryChannelCatalog(wsUrl, pubkey),
    bootstrapGeneralChannelId,
  );
  const autoJoin = selectAutoJoinChannel(channels);
  if (autoJoin) {
    await joinChatChannel(autoJoin.id, wsUrl);
    channels = includeBootstrapGeneralChannel(
      await queryChannelCatalog(wsUrl, pubkey),
      bootstrapGeneralChannelId,
      true,
    );
  }
  return { pubkey, channels };
}

export async function joinChatChannel(
  channelId: string,
  wsUrl = relayWsUrl(),
): Promise<void> {
  const signed = await signNostrEvent({
    kind: 9021,
    tags: [["h", channelId]],
    content: "",
  });
  await publishEvent(wsUrl, signed);
}

export async function loadChatMessages(
  channelId: string,
  wsUrl = relayWsUrl(),
): Promise<NostrEvent[]> {
  const events = await queryEvents(wsUrl, {
    kinds: CHAT_MESSAGE_KINDS,
    "#h": [channelId],
    limit: MESSAGE_QUERY_LIMIT,
  });
  return mergeChatMessages([], events);
}

export async function sendChatMessage(
  channelId: string,
  content: string,
  wsUrl = relayWsUrl(),
): Promise<NostrEvent> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("Write a message first.");
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new Error("Message is too long.");
  }
  const signed = await signNostrEvent({
    kind: 9,
    tags: [["h", channelId]],
    content: trimmed,
  });
  await publishEvent(wsUrl, signed);
  return signed;
}

export function subscribeToChatChannel(
  channelId: string,
  onEvent: (event: NostrEvent) => void,
  onError: (error: Error) => void,
  wsUrl = relayWsUrl(),
): () => void {
  return subscribeEvents(
    wsUrl,
    {
      kinds: CHAT_MESSAGE_KINDS,
      "#h": [channelId],
      since: Math.floor(Date.now() / 1000),
    },
    { onEvent, onError },
  );
}
