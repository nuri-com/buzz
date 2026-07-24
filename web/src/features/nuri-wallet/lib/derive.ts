import { secp256k1, schnorr } from "@noble/curves/secp256k1";
import { hkdf } from "@noble/hashes/hkdf";
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha2";
import { HDKey } from "@scure/bip32";
import { bech32, bech32m } from "bech32";

export const NURI_DERIVATION_VERSION = "nuri-expo-wallet-v1";
export const NURI_PRF_SALT = "nuri-prf-salt-v1";

const WALLET_SALT = sha256(utf8("app:nuri.com|wallet|v1"));
const BITCOIN_INFO = utf8("app:nuri.com|wallet|v1|chain=bitcoin|fmt=taproot");
const ETHEREUM_INFO = utf8(
  "app:nuri.com|wallet|v1|chain=ethereum|fmt=secp256k1",
);
const NOSTR_SALT = sha256(utf8("nuri-nostr-salt-v1"));
const NOSTR_INFO = utf8("nuri:nostr:sk:v1");
const BIP86_PATH = "m/86'/0'/0'/0/0";
const ETH_PATH = "m/44'/60'/0'/0/0";

export type NuriWalletPublic = {
  derivation_version: typeof NURI_DERIVATION_VERSION;
  bitcoin_address: string;
  bitcoin_xonly_pubkey_hex: string;
  client_public_key_33_hex: string;
  arkade_single_sig_xonly_pubkey_hex: string;
  eth_user_eoa: string;
  ethereum_public_key_hex: string;
  nostr_pubkey_hex: string;
  nostr_npub: string;
};

export type NuriWallet = {
  public: NuriWalletPublic;
  secrets: {
    bitcoin_private_key: Uint8Array;
    ethereum_private_key: Uint8Array;
    nostr_private_key: Uint8Array;
  };
};

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

export function zeroize(value: Uint8Array | null | undefined): void {
  value?.fill(0);
}

function deriveNostrPrivateKey(bitcoinPrivateKey: Uint8Array): Uint8Array {
  let candidate = hkdf(
    sha256,
    sha256(bitcoinPrivateKey),
    NOSTR_SALT,
    NOSTR_INFO,
    32,
  );
  for (let attempt = 0; attempt < 256; attempt += 1) {
    if (secp256k1.utils.isValidPrivateKey(candidate)) return candidate;
    const next = sha256(candidate);
    zeroize(candidate);
    candidate = next;
  }
  zeroize(candidate);
  throw new Error("nostr_private_key_derivation_failed");
}

function taprootAddress(childPublicKey: Uint8Array): {
  address: string;
  xOnly: Uint8Array;
} {
  const internal = childPublicKey.slice(1);
  const tag = sha256(utf8("TapTweak"));
  const tweak = sha256(new Uint8Array([...tag, ...tag, ...internal]));
  const tweakScalar = bytesToBigInt(tweak) % secp256k1.CURVE.n;
  const point = secp256k1.Point.fromHex(childPublicKey).add(
    secp256k1.Point.BASE.multiply(tweakScalar),
  );
  const xOnly = point.toRawBytes(true).slice(1);
  return {
    address: bech32m.encode("bc", [1, ...bech32m.toWords(xOnly)]),
    xOnly,
  };
}

function ethereumChecksumAddress(publicKey: Uint8Array): string {
  const lower = bytesToHex(keccak_256(publicKey).slice(-20));
  const hash = bytesToHex(keccak_256(utf8(lower)));
  let checksummed = "";
  for (let index = 0; index < lower.length; index += 1) {
    checksummed +=
      Number.parseInt(hash[index] ?? "0", 16) >= 8
        ? lower[index]?.toUpperCase()
        : lower[index];
  }
  return `0x${checksummed}`;
}

export function deriveNuriWallet(prf: Uint8Array): NuriWallet {
  const bitcoinEntropy = hkdf(sha256, prf, WALLET_SALT, BITCOIN_INFO, 32);
  const ethereumEntropy = hkdf(sha256, prf, WALLET_SALT, ETHEREUM_INFO, 32);
  const bitcoinRoot = HDKey.fromMasterSeed(bitcoinEntropy);
  const ethereumRoot = HDKey.fromMasterSeed(ethereumEntropy);
  const bitcoinChild = bitcoinRoot.derive(BIP86_PATH);
  const ethereumChild = ethereumRoot.derive(ETH_PATH);

  try {
    if (
      !bitcoinChild.privateKey ||
      !bitcoinChild.publicKey ||
      !ethereumChild.privateKey
    ) {
      throw new Error("wallet_derivation_failed");
    }
    const bitcoinPrivateKey = new Uint8Array(bitcoinChild.privateKey);
    const ethereumPrivateKey = new Uint8Array(ethereumChild.privateKey);
    const nostrPrivateKey = deriveNostrPrivateKey(bitcoinPrivateKey);
    const clientPublicKey = secp256k1.getPublicKey(bitcoinPrivateKey, true);
    const taproot = taprootAddress(bitcoinChild.publicKey);
    const nostrPubkey = schnorr.getPublicKey(nostrPrivateKey);
    const ethereumPublicKey = secp256k1
      .getPublicKey(ethereumPrivateKey, false)
      .slice(1);

    return {
      public: {
        derivation_version: NURI_DERIVATION_VERSION,
        bitcoin_address: taproot.address,
        bitcoin_xonly_pubkey_hex: bytesToHex(taproot.xOnly),
        client_public_key_33_hex: bytesToHex(clientPublicKey),
        arkade_single_sig_xonly_pubkey_hex: bytesToHex(
          clientPublicKey.slice(1),
        ),
        eth_user_eoa: ethereumChecksumAddress(ethereumPublicKey),
        ethereum_public_key_hex: bytesToHex(ethereumPublicKey),
        nostr_pubkey_hex: bytesToHex(nostrPubkey),
        nostr_npub: bech32.encode("npub", bech32.toWords(nostrPubkey)),
      },
      secrets: {
        bitcoin_private_key: bitcoinPrivateKey,
        ethereum_private_key: ethereumPrivateKey,
        nostr_private_key: nostrPrivateKey,
      },
    };
  } finally {
    bitcoinRoot.wipePrivateData();
    bitcoinChild.wipePrivateData();
    ethereumRoot.wipePrivateData();
    ethereumChild.wipePrivateData();
    zeroize(bitcoinEntropy);
    zeroize(ethereumEntropy);
  }
}

export function zeroizeNuriWallet(wallet: NuriWallet | null | undefined): void {
  if (!wallet) return;
  zeroize(wallet.secrets.bitcoin_private_key);
  zeroize(wallet.secrets.ethereum_private_key);
  zeroize(wallet.secrets.nostr_private_key);
}
