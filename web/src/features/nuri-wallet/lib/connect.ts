import type { NuriWalletPublic } from "./derive";

const CONNECT_BASE_URL = "https://connect.nuri.com";
const PENDING_KEY = "nuri-buzz-connect-pending-v1";

export type ConnectFlow = "create" | "access";

export type ConnectPending = {
  flow: ConnectFlow;
  sessionId: string;
  returnNonce: string;
};

export type ConnectApprovedResult = {
  status: "approved";
  kind: "create" | "connect";
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

/**
 * Where Connect sends the browser back.
 *
 * Must keep the current path: returning to the origin dropped every deep link
 * (a login started on /admin landed in the chat). Query and hash are dropped
 * so a stale `nuri_connect` value cannot ride along into the new flow.
 */
export function connectReturnUrl(
  origin: string,
  pathname: string,
  returnNonce: string,
): string {
  const url = new URL(pathname, origin);
  url.search = "";
  url.hash = "";
  url.searchParams.set("nuri_connect", returnNonce);
  return url.toString();
}

export function validSessionId(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

export function validApprovalUrl(
  value: string,
  sessionId: string,
  flow: ConnectFlow,
): boolean {
  try {
    const url = new URL(value);
    const pathPrefix = flow === "create" ? "create" : "approve";
    return (
      url.origin === CONNECT_BASE_URL &&
      url.pathname === `/${pathPrefix}/${sessionId}`
    );
  } catch {
    return false;
  }
}

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
    throw new Error(
      String(value.error ?? `connect_request_failed_${response.status}`),
    );
  }
  return value as T;
}

export async function startConnectFlow(
  flow: ConnectFlow,
): Promise<ConnectStartResult> {
  const returnNonce = crypto.randomUUID();
  const callback = connectReturnUrl(
    window.location.origin,
    window.location.pathname,
    returnNonce,
  );
  const result = await connectRequest<ConnectStartResult>(
    endpoint(flow, "start"),
    { return_url: callback },
  );
  if (
    result.status !== "pending" ||
    !validSessionId(result.session_id) ||
    !validApprovalUrl(result.approval_url, result.session_id, flow)
  ) {
    throw new Error("connect_start_response_invalid");
  }
  sessionStorage.setItem(
    PENDING_KEY,
    JSON.stringify({
      flow,
      sessionId: result.session_id,
      returnNonce,
    } satisfies ConnectPending),
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
      validSessionId(value.sessionId) &&
      typeof value.returnNonce === "string" &&
      value.returnNonce.length >= 32
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

export function matchesConnectReturn(
  pending: ConnectPending | null,
  returnNonce: string | null,
): boolean {
  return pending !== null && returnNonce === pending.returnNonce;
}

export async function waitForConnectApproval(
  pending: ConnectPending,
): Promise<ConnectApprovedResult> {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const result = await connectRequest<ConnectPollResult>(
      endpoint(pending.flow, "result"),
      { session_id: pending.sessionId },
    );
    if (result.status === "approved") {
      const expectedKind = pending.flow === "create" ? "create" : "connect";
      if (
        result.session_id !== pending.sessionId ||
        result.kind !== expectedKind
      ) {
        throw new Error(
          "Connect approval response does not match this session",
        );
      }
      return result;
    }
    if (result.status === "expired") throw new Error("Connect session expired");
    await new Promise((resolve) => window.setTimeout(resolve, 1_000));
  }
  throw new Error("Connect approval timed out");
}
