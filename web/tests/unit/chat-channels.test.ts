import assert from "node:assert/strict";
import test from "node:test";

import { toChannels } from "../../src/features/chat/channels.ts";

function metadata(
  d: string,
  name: string,
  createdAt: number,
  extra: string[][] = [],
) {
  return {
    id: `${d}-${createdAt}`,
    pubkey: "relay",
    sig: "",
    kind: 39000,
    created_at: createdAt,
    content: "",
    tags: [["d", d], ["name", name], ...extra],
  };
}

test("keeps the newest metadata per channel and sorts by name", () => {
  const channels = toChannels([
    metadata("b", "zulu", 10),
    metadata("a", "old-name", 10),
    metadata("a", "alpha", 20),
  ]);
  assert.deepEqual(
    channels.map((channel) => [channel.id, channel.name]),
    [
      ["a", "alpha"],
      ["b", "zulu"],
    ],
  );
});

test("hides DMs and private channels", () => {
  const channels = toChannels([
    metadata("dm", "direct", 10, [["hidden"]]),
    metadata("secret", "secret", 10, [["private"]]),
    metadata("open", "support", 10, [["public"]]),
  ]);
  assert.deepEqual(
    channels.map((channel) => channel.id),
    ["open"],
  );
});
