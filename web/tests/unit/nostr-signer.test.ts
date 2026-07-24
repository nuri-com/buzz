import assert from "node:assert/strict";
import test from "node:test";
import { getPublicKey } from "nostr-tools/pure";

import {
  hasNuriSigner,
  lockNuriSigner,
  signNostrEvent,
  unlockNuriSigner,
} from "../../src/shared/lib/nostr-signer.ts";

test("Nuri signer signs from a copied session key and locks cleanly", async () => {
  const secretKey = new Uint8Array(32).fill(1);
  const expectedPubkey = getPublicKey(secretKey);

  assert.equal(unlockNuriSigner(secretKey), expectedPubkey);
  secretKey.fill(0);
  assert.equal(hasNuriSigner(), true);

  const signed = await signNostrEvent({
    kind: 1,
    created_at: 1,
    tags: [],
    content: "hello",
  });
  assert.equal(signed.pubkey, expectedPubkey);

  lockNuriSigner();
  assert.equal(hasNuriSigner(), false);
});
