import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeChatMessages,
  projectChatChannels,
  selectAutoJoinChannel,
} from "../../src/features/chat/lib/chat.ts";
import type { NostrEvent } from "../../src/shared/lib/nostr-client.ts";

function event(
  id: string,
  kind: number,
  tags: string[][],
  content = "",
  createdAt = 1,
): NostrEvent {
  return {
    id: id.padEnd(64, "0"),
    pubkey: "ab".repeat(32),
    sig: "cd".repeat(64),
    kind,
    tags,
    content,
    created_at: createdAt,
  };
}

test("projects channel memberships onto relay metadata", () => {
  const generalId = "11111111-1111-4111-8111-111111111111";
  const privateId = "22222222-2222-4222-8222-222222222222";
  const publicId = "33333333-3333-4333-8333-333333333333";

  const channels = projectChatChannels(
    [
      event("member-general", 39002, [["d", generalId]]),
      event("member-private", 39002, [["d", privateId]]),
    ],
    [
      event("meta-public", 39000, [
        ["d", publicId],
        ["name", "random"],
      ]),
      event("meta-private", 39000, [
        ["d", privateId],
        ["name", "staff"],
        ["private"],
      ]),
      event("meta-general", 39000, [
        ["d", generalId],
        ["name", "general"],
      ]),
    ],
  );

  assert.deepEqual(
    channels.map(({ id, name, visibility, isMember }) => ({
      id,
      name,
      visibility,
      isMember,
    })),
    [
      { id: generalId, name: "general", visibility: "open", isMember: true },
      { id: privateId, name: "staff", visibility: "private", isMember: true },
      { id: publicId, name: "random", visibility: "open", isMember: false },
    ],
  );
});

test("hides archived channels and private channels without membership", () => {
  const archivedId = "44444444-4444-4444-8444-444444444444";
  const privateId = "55555555-5555-4555-8555-555555555555";

  const channels = projectChatChannels(
    [],
    [
      event("archived", 39000, [
        ["d", archivedId],
        ["name", "old"],
        ["archived", "true"],
      ]),
      event("private", 39000, [
        ["d", privateId],
        ["name", "secret"],
        ["private"],
      ]),
    ],
  );

  assert.deepEqual(channels, []);
});

test("selects the single open general channel only for a new member", () => {
  const general = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "general",
    type: "stream" as const,
    visibility: "open" as const,
    isMember: false,
  };
  assert.equal(selectAutoJoinChannel([general]), general);
  assert.equal(selectAutoJoinChannel([{ ...general, isMember: true }]), null);
  assert.equal(
    selectAutoJoinChannel([
      general,
      { ...general, id: "22222222-2222-4222-8222-222222222222" },
    ]),
    null,
  );
});

test("merges supported chat messages by id in chronological order", () => {
  const channelId = "11111111-1111-4111-8111-111111111111";
  const first = event("first", 9, [["h", channelId]], "one", 10);
  const second = event("second", 40002, [["h", channelId]], "two", 20);
  const unsupported = event("reaction", 7, [["h", channelId]], "+", 30);

  assert.deepEqual(
    mergeChatMessages([second], [first, second, unsupported]).map(
      ({ content }) => content,
    ),
    ["one", "two"],
  );
});
