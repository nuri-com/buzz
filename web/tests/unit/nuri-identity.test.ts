import assert from "node:assert/strict";
import test from "node:test";

import { deriveNuriWallet, zeroizeNuriWallet } from "../../src/features/nuri-wallet/lib/derive.ts";
import { assertSameNuriWallet } from "../../src/features/nuri-wallet/lib/identity.ts";

test("accepts only the exact Connect public wallet tuple", () => {
  const wallet = deriveNuriWallet(Uint8Array.from({ length: 32 }, (_, index) => index));
  try {
    assert.doesNotThrow(() => assertSameNuriWallet(wallet.public, { ...wallet.public }));
    assert.throws(
      () =>
        assertSameNuriWallet(wallet.public, {
          ...wallet.public,
          nostr_pubkey_hex: "00".repeat(32),
        }),
      /nostr_pubkey_hex/,
    );
  } finally {
    zeroizeNuriWallet(wallet);
  }
});
