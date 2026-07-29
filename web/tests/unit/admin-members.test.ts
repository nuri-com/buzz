import assert from "node:assert/strict";
import test from "node:test";

import { isPubkeyHex, toMembers } from "../../src/features/admin/members.ts";

function snapshot(createdAt: number, entries: string[][]) {
  return {
    id: `snap-${createdAt}`,
    pubkey: "relay",
    sig: "",
    kind: 13534,
    created_at: createdAt,
    content: "",
    tags: [["-"], ...entries.map(([pubkey, role]) => ["member", pubkey, role])],
  };
}

test("uses only the newest snapshot and orders owner, admin, member", () => {
  const members = toMembers([
    snapshot(10, [["aa", "member"]]),
    snapshot(20, [
      ["cc", "member"],
      ["aa", "owner"],
      ["bb", "admin"],
    ]),
  ]);
  assert.deepEqual(members, [
    { pubkey: "aa", role: "owner" },
    { pubkey: "bb", role: "admin" },
    { pubkey: "cc", role: "member" },
  ]);
});

test("drops tags that are not well-formed member entries", () => {
  const members = toMembers([
    snapshot(10, [
      ["aa", "member"],
      ["bb", "wizard"],
    ]),
  ]);
  assert.deepEqual(members, [{ pubkey: "aa", role: "member" }]);
});

test("accepts only 64-char hex pubkeys", () => {
  assert.equal(isPubkeyHex("a".repeat(64)), true);
  assert.equal(isPubkeyHex("a".repeat(63)), false);
  assert.equal(isPubkeyHex(`${"z".repeat(64)}`), false);
});
