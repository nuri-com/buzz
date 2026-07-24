import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveNuriWallet,
  zeroizeNuriWallet,
} from "../../src/features/nuri-wallet/lib/derive.ts";

const APP_GOLDEN_VECTOR = {
  derivation_version: "nuri-expo-wallet-v1",
  bitcoin_address:
    "bc1puu4572sxxrmkr5upg36lfs7mp0lmscs2pmn4y5e3f44jrcnxperq2c6jcq",
  bitcoin_xonly_pubkey_hex:
    "e72b4f2a0630f761d3814475f4c3db0bffb8620a0ee75253314d6b21e2660e46",
  client_public_key_33_hex:
    "0312f22cf30d36050511b1855f2009d8fed9ccf506a2d9ddb0535d86cdb4ae07bb",
  arkade_single_sig_xonly_pubkey_hex:
    "12f22cf30d36050511b1855f2009d8fed9ccf506a2d9ddb0535d86cdb4ae07bb",
  eth_user_eoa: "0x4472aaB1a5FAfaC3a57a368c128c7953362Af785",
  ethereum_public_key_hex:
    "e5866050df9d4888ac8b41faf5e0440a5fb55c7606356fa05df8d4469b9525638c34245093c93bad4053c687ec46b81423d1f039b91b1ebb82142bf90b80d3ca",
  nostr_pubkey_hex:
    "cb39417613bb55225a751ffa14d7099e6c06c9da59936dacdd36824ad447e47f",
  nostr_npub: "npub1evu5zasnhd2jykn4rlapf4cfnekqdjw6txfkmtxax6py44z8u3lsl63q4l",
};

test("matches the frozen Nuri Expo PRF vector", () => {
  const prf = Uint8Array.from({ length: 32 }, (_, index) => index);
  const wallet = deriveNuriWallet(prf);
  try {
    assert.deepEqual(wallet.public, APP_GOLDEN_VECTOR);
  } finally {
    zeroizeNuriWallet(wallet);
    prf.fill(0);
  }
});

test("zeroizes every derived private key", () => {
  const wallet = deriveNuriWallet(new Uint8Array(32).fill(7));
  zeroizeNuriWallet(wallet);
  assert.equal(
    wallet.secrets.bitcoin_private_key.every((byte) => byte === 0),
    true,
  );
  assert.equal(
    wallet.secrets.ethereum_private_key.every((byte) => byte === 0),
    true,
  );
  assert.equal(
    wallet.secrets.nostr_private_key.every((byte) => byte === 0),
    true,
  );
});
