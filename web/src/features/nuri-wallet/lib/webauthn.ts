import {
  NURI_PRF_SALT,
  deriveNuriWallet,
  type NuriWallet,
  zeroize,
} from "./derive";

function base64UrlToBuffer(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
    .buffer;
}

function readPrf(credential: PublicKeyCredential): Uint8Array | null {
  const extensions = credential.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const first = extensions.prf?.results?.first;
  return first ? new Uint8Array(first) : null;
}

/**
 * Wait until the document has focus.
 *
 * Chrome rejects `navigator.credentials.get()` with "The document is not
 * focused." — which is exactly what happens when the Connect redirect lands
 * and the gate reaches for the passkey before the tab is focused again.
 */
function whenDocumentFocused(): Promise<void> {
  if (document.hasFocus()) return Promise.resolve();
  return new Promise((resolve) => {
    const onFocus = () => {
      window.removeEventListener("focus", onFocus);
      resolve();
    };
    window.addEventListener("focus", onFocus);
  });
}

export async function unlockNuriPasskey(
  credentialId?: string,
): Promise<NuriWallet> {
  if (!navigator.credentials || typeof PublicKeyCredential === "undefined") {
    throw new Error("Passkeys are not supported in this browser");
  }

  await whenDocumentFocused();

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const request: PublicKeyCredentialRequestOptions = {
    challenge,
    rpId: "nuri.com",
    userVerification: "required",
    timeout: 60_000,
    ...(credentialId
      ? {
          allowCredentials: [
            { id: base64UrlToBuffer(credentialId), type: "public-key" },
          ],
        }
      : {}),
    extensions: {
      prf: { eval: { first: new TextEncoder().encode(NURI_PRF_SALT) } },
    } as AuthenticationExtensionsClientInputs,
  };

  const credential = (await navigator.credentials.get({
    publicKey: request,
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("Passkey unlock was cancelled");

  const prf = readPrf(credential);
  if (!prf) {
    throw new Error("This passkey or browser does not support WebAuthn PRF");
  }
  try {
    return deriveNuriWallet(prf);
  } finally {
    zeroize(prf);
    zeroize(challenge);
  }
}
