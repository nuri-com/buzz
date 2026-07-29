import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

export type UnsignedNostrEvent = {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
};

export type SignedNostrEvent = UnsignedNostrEvent & {
  id: string;
  pubkey: string;
  sig: string;
};

type Nip07Provider = {
  getPublicKey(): Promise<string>;
  signEvent(event: UnsignedNostrEvent): Promise<SignedNostrEvent>;
};

declare global {
  interface Window {
    nostr?: Nip07Provider;
  }
}

export class Nip07UnavailableError extends Error {
  constructor() {
    super(
      "Unlock a Nuri Passkey Wallet or install a NIP-07 browser extension.",
    );
    this.name = "Nip07UnavailableError";
  }
}

let ephemeralSecretKey: Uint8Array | null = null;
let nuriSecretKey: Uint8Array | null = null;
let nuriPubkey: string | null = null;

function zeroizeSecretKey(secretKey: Uint8Array | null): void {
  secretKey?.fill(0);
}

export function unlockNuriSigner(secretKey: Uint8Array): string {
  const copy = secretKey.slice();
  const pubkey = getPublicKey(copy);
  zeroizeSecretKey(nuriSecretKey);
  nuriSecretKey = copy;
  nuriPubkey = pubkey;
  return pubkey;
}

export function lockNuriSigner(): void {
  zeroizeSecretKey(nuriSecretKey);
  nuriSecretKey = null;
  nuriPubkey = null;
}

/** Public key of whichever signer would sign right now, or null if none. */
export async function currentSignerPubkey(): Promise<string | null> {
  if (nuriPubkey) return nuriPubkey;
  const provider = typeof window === "undefined" ? undefined : window.nostr;
  return provider ? await provider.getPublicKey() : null;
}

export function hasNuriSigner(): boolean {
  return nuriSecretKey !== null;
}

function getEphemeralSecretKey(): Uint8Array {
  if (!ephemeralSecretKey) {
    ephemeralSecretKey = generateSecretKey();
  }
  return ephemeralSecretKey;
}

export function hasNip07Provider(): boolean {
  return typeof window !== "undefined" && window.nostr != null;
}

export function hasBrowserSigner(): boolean {
  return hasNuriSigner() || hasNip07Provider();
}

export async function getBrowserPublicKey(): Promise<string> {
  if (nuriSecretKey) {
    return getPublicKey(nuriSecretKey);
  }
  const provider = typeof window === "undefined" ? undefined : window.nostr;
  if (!provider) throw new Nip07UnavailableError();
  const pubkey = await provider.getPublicKey();
  if (!/^[0-9a-f]{64}$/i.test(pubkey)) {
    throw new Error("The NIP-07 extension returned an invalid public key.");
  }
  return pubkey.toLowerCase();
}

function sameUnsignedEvent(
  expected: UnsignedNostrEvent,
  actual: SignedNostrEvent,
): boolean {
  return (
    actual.kind === expected.kind &&
    actual.created_at === expected.created_at &&
    actual.content === expected.content &&
    JSON.stringify(actual.tags) === JSON.stringify(expected.tags)
  );
}

/**
 * Sign with NIP-07 when available, otherwise use a page-lifetime key.
 *
 * The ephemeral fallback preserves anonymous browsing on open relays. Flows
 * that create durable membership must set `requireNip07` so a reload cannot
 * orphan a relay-membership row.
 */
export async function signNostrEvent(
  template: Omit<UnsignedNostrEvent, "created_at"> & {
    created_at?: number;
  },
  options?: { requireNip07?: boolean },
): Promise<SignedNostrEvent> {
  const unsigned: UnsignedNostrEvent = {
    ...template,
    created_at: template.created_at ?? Math.floor(Date.now() / 1000),
  };

  if (nuriSecretKey) {
    return finalizeEvent(unsigned, nuriSecretKey);
  }

  const provider = typeof window === "undefined" ? undefined : window.nostr;

  if (provider) {
    const expectedPubkey = await provider.getPublicKey();
    const signed = await provider.signEvent(unsigned);
    if (
      signed.pubkey !== expectedPubkey ||
      !sameUnsignedEvent(unsigned, signed) ||
      typeof signed.id !== "string" ||
      typeof signed.sig !== "string"
    ) {
      throw new Error("The NIP-07 extension returned an invalid signed event.");
    }
    return signed;
  }

  if (options?.requireNip07) {
    throw new Nip07UnavailableError();
  }

  const secretKey = getEphemeralSecretKey();
  const signed = finalizeEvent(unsigned, secretKey);
  if (signed.pubkey !== getPublicKey(secretKey)) {
    throw new Error("Failed to create the ephemeral browser identity.");
  }
  return signed;
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", lockNuriSigner);
}
