import type { NuriWalletPublic } from "./derive";

const PUBLIC_IDENTITY_FIELDS = [
  "derivation_version",
  "bitcoin_address",
  "bitcoin_xonly_pubkey_hex",
  "client_public_key_33_hex",
  "arkade_single_sig_xonly_pubkey_hex",
  "eth_user_eoa",
  "ethereum_public_key_hex",
  "nostr_pubkey_hex",
  "nostr_npub",
] as const satisfies readonly (keyof NuriWalletPublic)[];

export function assertSameNuriWallet(
  local: NuriWalletPublic,
  connect: NuriWalletPublic,
): void {
  for (const field of PUBLIC_IDENTITY_FIELDS) {
    if (local[field] !== connect[field]) {
      throw new Error(`Connect wallet mismatch: ${field}`);
    }
  }
}
