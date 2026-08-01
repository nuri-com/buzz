import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSpaceSlug,
  parseSpaceInvite,
  spaceHost,
} from "../../src/features/spaces/lib/space.ts";

test("normalizes a human Space name into a DNS label", () => {
  assert.equal(normalizeSpaceSlug("  Nuri Builders  "), "nuri-builders");
  assert.equal(normalizeSpaceSlug("Design & Product"), "design-product");
});

test("builds only canonical Space relay hosts", () => {
  assert.equal(spaceHost("nuri-builders"), "nuri-builders.relay.nuri.com");
  assert.throws(() => spaceHost("Bad_Slug"), /invalid space slug/i);
  assert.throws(() => spaceHost("-leading"), /invalid space slug/i);
  assert.throws(() => spaceHost("a".repeat(64)), /invalid space slug/i);
});

test("parses only canonical private Space invite URLs", () => {
  assert.deepEqual(
    parseSpaceInvite("https://nuri-builders.relay.nuri.com/invite/abc123"),
    {
      code: "abc123",
      host: "nuri-builders.relay.nuri.com",
      relayUrl: "wss://nuri-builders.relay.nuri.com",
      slug: "nuri-builders",
    },
  );
  assert.throws(
    () => parseSpaceInvite("https://evil.example/invite/abc123"),
    /invalid space invite/i,
  );
  assert.throws(
    () => parseSpaceInvite("https://a.relay.nuri.com/other/abc123"),
    /invalid space invite/i,
  );
});
