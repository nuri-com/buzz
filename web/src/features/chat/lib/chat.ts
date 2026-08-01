import type { NostrEvent } from "@/shared/lib/nostr-client";

export type ChatChannelType = "stream" | "forum" | "dm" | "private" | "unknown";
export type ChatChannelVisibility = "open" | "private";

export type ChatChannel = {
  id: string;
  name: string;
  type: ChatChannelType;
  visibility: ChatChannelVisibility;
  isMember: boolean;
};

const CHAT_MESSAGE_KINDS = new Set([9, 40002]);

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}

function hasTag(event: NostrEvent, name: string): boolean {
  return event.tags.some((tag) => tag[0] === name);
}

function channelType(event: NostrEvent): ChatChannelType {
  const declared = tagValue(event, "t");
  if (declared === "forum" || declared === "dm" || declared === "private") {
    return declared;
  }
  if (hasTag(event, "hidden")) return "dm";
  if (hasTag(event, "private")) return "private";
  return declared ? "unknown" : "stream";
}

function channelVisibility(event: NostrEvent): ChatChannelVisibility {
  return hasTag(event, "private") || channelType(event) === "private"
    ? "private"
    : "open";
}

export function projectChatChannels(
  membershipEvents: NostrEvent[],
  metadataEvents: NostrEvent[],
): ChatChannel[] {
  const memberships = new Set(
    membershipEvents
      .filter((event) => event.kind === 39002)
      .map((event) => tagValue(event, "d"))
      .filter((id): id is string => Boolean(id)),
  );
  const latestMetadata = new Map<string, NostrEvent>();

  for (const event of metadataEvents) {
    if (event.kind !== 39000) continue;
    const id = tagValue(event, "d");
    if (!id) continue;
    const previous = latestMetadata.get(id);
    if (!previous || event.created_at >= previous.created_at) {
      latestMetadata.set(id, event);
    }
  }

  return [...latestMetadata.entries()]
    .filter(([, event]) => tagValue(event, "archived") !== "true")
    .map(([id, event]): ChatChannel => {
      const isMember = memberships.has(id);
      return {
        id,
        name: tagValue(event, "name")?.trim() || "unnamed",
        type: channelType(event),
        visibility: channelVisibility(event),
        isMember,
      };
    })
    .filter((channel) => channel.visibility === "open" || channel.isMember)
    .sort((left, right) => {
      if (left.isMember !== right.isMember) return left.isMember ? -1 : 1;
      const leftGeneral = left.name.toLowerCase() === "general";
      const rightGeneral = right.name.toLowerCase() === "general";
      if (leftGeneral !== rightGeneral) return leftGeneral ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, {
        sensitivity: "base",
      });
    });
}

export function selectAutoJoinChannel(
  channels: ChatChannel[],
): ChatChannel | null {
  if (channels.some((channel) => channel.isMember)) return null;
  const candidates = channels.filter(
    (channel) =>
      channel.visibility === "open" &&
      channel.type === "stream" &&
      channel.name.toLowerCase() === "general",
  );
  return candidates.length === 1 ? candidates[0] : null;
}

export function includeBootstrapGeneralChannel(
  channels: ChatChannel[],
  channelId: string | undefined,
  isMember = false,
): ChatChannel[] {
  if (!channelId || channels.some((channel) => channel.id === channelId)) {
    return channels;
  }
  return [
    {
      id: channelId,
      name: "general",
      type: "stream",
      visibility: "open",
      isMember,
    },
    ...channels,
  ];
}

export function mergeChatMessages(
  current: NostrEvent[],
  incoming: NostrEvent[],
): NostrEvent[] {
  const byId = new Map<string, NostrEvent>();
  for (const event of [...current, ...incoming]) {
    if (CHAT_MESSAGE_KINDS.has(event.kind)) byId.set(event.id, event);
  }
  return [...byId.values()].sort(
    (left, right) =>
      left.created_at - right.created_at || left.id.localeCompare(right.id),
  );
}
