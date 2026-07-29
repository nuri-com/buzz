import type { NostrEvent } from "@/shared/lib/nostr-client";

export type ChannelVisibility = "open" | "private";

export type ChatChannel = {
  id: string;
  name: string;
  about?: string;
  visibility: ChannelVisibility;
};

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}

function hasTag(event: NostrEvent, name: string): boolean {
  return event.tags.some((tag) => tag[0] === name);
}

/**
 * Newest kind:39000 per `d` tag, minus DMs.
 *
 * Private channels stay in the list on purpose: kind:39000 is stored
 * channel-scoped, so the relay only hands back channels this member may
 * access — a private channel in the response is one they belong to.
 */
export function toChannels(events: NostrEvent[]): ChatChannel[] {
  const newest = new Map<string, NostrEvent>();
  for (const event of events) {
    const id = tagValue(event, "d");
    if (!id || hasTag(event, "hidden")) continue;
    const seen = newest.get(id);
    if (!seen || seen.created_at < event.created_at) newest.set(id, event);
  }
  return [...newest.entries()]
    .map(([id, event]) => ({
      id,
      name: tagValue(event, "name") ?? id.slice(0, 8),
      about: tagValue(event, "about"),
      visibility: hasTag(event, "private")
        ? ("private" as const)
        : ("open" as const),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
