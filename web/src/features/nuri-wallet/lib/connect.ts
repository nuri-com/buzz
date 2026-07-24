import type { NuriWalletPublic } from "./derive";

const CONNECT_BASE_URL = "https://connect.nuri.com";
const PENDING_KEY = "nuri-buzz-connect-pending-v1";

export type ConnectFlow = "create" | "access";

export type ConnectPending = {
  flow: ConnectFlow;
  sessionId: string;
};

export type ConnectApprovedResult = {
  status: "approved";
  kind: string;
  session_id: string;
  wallet: NuriWalletPublic & {
    cred_id_b64u?: string;
    credential_pubkey_b64u?: string;
  };
  account?: Record<string, unknown>;
};

type ConnectStartResult = {
  status: "pending";
  session_id: string;
  approval_url: string;
};

type ConnectPollResult =
  | ConnectApprovedResult
  | {
      status: "pending" | "binding" | "awaiting_nostr" | "expired";
      session_id: string;
    };

function endpoint(flow: ConnectFlow, action: "start" | "result"): string {
  if (flow === "create") return `/api/wallet_create_${action}`;
  return `/api/wallet_connect_${action}`;
}

async function connectRequest<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${CONNECT_BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new Error(String(value.error ?? `connect_request_failed_${response.status}`));
  }
  return value as T;
}

export async function startConnectFlow(
  flow: ConnectFlow,
): Promise<ConnectStartResult> {
  const callback = new URL(window.location.origin);
  callback.searchParams.set("nuri_connect", "return");
  const result = await connectRequest<ConnectStartResult>(
    endpoint(flow, "start"),
    { return_url: callback.toString() },
  );
  if (!result.session_id || !result.approval_url) {
    throw new Error("connect_start_response_invalid");
  }
  sessionStorage.setItem(
    PENDING_KEY,
    JSON.stringify({ flow, sessionId: result.session_id } satisfies ConnectPending),
  );
  return result;
}

export function readPendingConnectFlow(): ConnectPending | null {
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as ConnectPending;
    if (
      (value.flow === "create" || value.flow === "access") &&
      value.sessionId
    ) {
      return value;
    }
  } catch {
    // Invalid browser state is cleared below.
  }
  sessionStorage.removeItem(PENDING_KEY);
  return null;
}

export function clearPendingConnectFlow(): void {
  sessionStorage.removeItem(PENDING_KEY);
}

export async function waitForConnectApproval(
  pending: ConnectPending,
): Promise<ConnectApprovedResult> {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const result = await connectRequest<ConnectPollResult>(
      endpoint(pending.flow, "result"),
      { session_id: pending.sessionId },
    );
    if (result.status === "approved") return result;
    if (result.status === "expired") throw new Error("Connect session expired");
    await new Promise((resolve) => window.setTimeout(resolve, 1_000));
  }
  throw new Error("Connect approval timed out");
}
