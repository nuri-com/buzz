import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import { relayHttpBaseUrl } from "@/shared/lib/relay-url";

export async function registerNuriMember(sessionId: string): Promise<void> {
  const url = `${relayHttpBaseUrl().replace(/\/+$/, "")}/api/nuri/register`;
  const body = JSON.stringify({ session_id: sessionId });
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
    error?: string;
  };
  if (!response.ok) {
    throw new Error(result.error ?? `Buzz registration failed (${response.status})`);
  }
}
