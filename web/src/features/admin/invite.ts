import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import { relayHttpBaseUrl } from "@/shared/lib/relay-url";

/**
 * Mint a relay invite link — `POST /api/invites`, owner/admin only.
 *
 * The code grants the `member` role; the relay hardcodes it
 * (`invite_token.rs:135`). Promote the joiner to admin afterwards with
 * kind:9032.
 */
export async function mintInviteLink(ttlSecs?: number): Promise<string> {
  const url = `${relayHttpBaseUrl().replace(/\/+$/, "")}/api/invites`;
  const body = JSON.stringify(ttlSecs ? { ttl_secs: ttlSecs } : {});
  const authorization = await makeNip98AuthHeader(url, "POST", {
    body,
    requireNip07: true,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body,
  });
  const result = (await response.json().catch(() => ({}))) as {
    url?: string;
    error?: string;
  };
  if (!response.ok || !result.url) {
    throw new Error(result.error ?? `Invite mint failed (${response.status})`);
  }
  return result.url;
}
