import { bech32 } from "bech32";

/** NIP-19 `npub` form of a 32-byte hex pubkey — the form humans compare. */
export function toNpub(pubkeyHex: string): string {
  const bytes = new Uint8Array(
    (pubkeyHex.match(/.{2}/g) ?? []).map((byte) => Number.parseInt(byte, 16)),
  );
  return bech32.encode("npub", bech32.toWords(bytes), 200);
}

/**
 * The ONE canonical compact display form for a pubkey: `abcd1234…wxyz`.
 * Mirrors desktop's `@/shared/lib/pubkey`. A truncated pubkey is a
 * recognition aid, never an identity proof — security decisions need the
 * full npub.
 */
export function truncatePubkey(pubkey: string): string {
  if (pubkey.length <= 12) {
    return pubkey;
  }
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
}
