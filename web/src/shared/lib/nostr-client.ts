/**
 * Minimal Nostr client with NIP-01 queries and NIP-42 AUTH.
 *
 * Uses NIP-07 when a browser extension is available, with an ephemeral
 * page-lifetime identity as the fallback for read-only queries on open relays.
 */

import { makeAuthEvent } from "nostr-tools/nip42";
import {
  type SignedNostrEvent,
  signNostrEvent,
} from "@/shared/lib/nostr-signer";

export interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  [tag: `#${string}`]: string[] | undefined;
}

export type NostrEvent = SignedNostrEvent;

const QUERY_TIMEOUT_MS = 10_000;
const PUBLISH_TIMEOUT_MS = 10_000;

/**
 * Open a WebSocket to `wsUrl`, authenticate via NIP-42 if challenged,
 * send a REQ with the given filter, collect EVENTs until EOSE, then
 * close and return them.
 */
export function queryEvents(
  wsUrl: string,
  filter: NostrFilter,
): Promise<NostrEvent[]> {
  return new Promise((resolve, reject) => {
    const events: NostrEvent[] = [];
    const subId = `q-${Date.now().toString(36)}`;
    let settled = false;
    let reqSent = false;
    let authEventId: string | null = null;
    let unauthenticatedReqTimer: ReturnType<typeof setTimeout> | null = null;

    const ws = new WebSocket(wsUrl);

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        reject(new Error(`Relay query timed out after ${QUERY_TIMEOUT_MS}ms`));
      }
    }, QUERY_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeout);
      if (unauthenticatedReqTimer) {
        clearTimeout(unauthenticatedReqTimer);
      }
      try {
        ws.close();
      } catch {
        // ignore
      }
    };

    const sendReq = () => {
      if (!reqSent) {
        reqSent = true;
        ws.send(JSON.stringify(["REQ", subId, filter]));
      }
    };

    ws.addEventListener("open", () => {
      // Wait briefly for an AUTH challenge before sending REQ.
      // Buzz relays always send AUTH, but other relays may not.
      unauthenticatedReqTimer = setTimeout(() => sendReq(), 100);
    });

    ws.addEventListener("message", async (msg) => {
      let data: unknown;
      try {
        data = JSON.parse(String(msg.data));
      } catch {
        return;
      }
      if (!Array.isArray(data)) return;

      const [type] = data;

      if (type === "AUTH" && typeof data[1] === "string") {
        // NIP-42: relay sent an AUTH challenge — sign and respond.
        if (unauthenticatedReqTimer) {
          clearTimeout(unauthenticatedReqTimer);
          unauthenticatedReqTimer = null;
        }
        const challenge = data[1];
        const template = makeAuthEvent(wsUrl, challenge);
        try {
          const signed = await signNostrEvent(template);
          if (settled) return;
          authEventId = signed.id;
          ws.send(JSON.stringify(["AUTH", signed]));
        } catch (error) {
          if (!settled) {
            settled = true;
            cleanup();
            reject(
              error instanceof Error
                ? error
                : new Error("Failed to sign relay authentication."),
            );
          }
        }
        return;
      }

      if (type === "OK" && data[1] === authEventId) {
        if (data[2] === true) {
          sendReq();
        } else if (!settled) {
          settled = true;
          cleanup();
          reject(
            new Error(
              typeof data[3] === "string"
                ? data[3]
                : "Relay authentication failed.",
            ),
          );
        }
        return;
      }

      if (type === "EVENT" && data[1] === subId && data[2]) {
        events.push(data[2] as NostrEvent);
      } else if (type === "EOSE" && data[1] === subId) {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(events);
        }
      } else if (type === "CLOSED" && data[1] === subId) {
        // Subscription was rejected (e.g. auth failed).
        if (!settled) {
          settled = true;
          cleanup();
          const reason =
            typeof data[2] === "string"
              ? data[2]
              : "subscription closed by relay";
          reject(new Error(reason));
        }
      } else if (type === "NOTICE") {
        // Informational notice from relay — ignore for now.
      }
    });

    ws.addEventListener("error", () => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error("WebSocket connection failed"));
      }
    });

    ws.addEventListener("close", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(events);
      }
    });
  });
}

/** Publish a signed event and wait for the relay's matching `OK` response. */
export function publishEvent(wsUrl: string, event: NostrEvent): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let settled = false;
    let eventSent = false;
    let authEventId: string | null = null;
    let unauthenticatedPublishTimer: ReturnType<typeof setTimeout> | null =
      null;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (unauthenticatedPublishTimer) {
        clearTimeout(unauthenticatedPublishTimer);
      }
      ws.close();
      if (error) reject(error);
      else resolve();
    };

    const timeout = setTimeout(
      () =>
        finish(
          new Error(`Relay publish timed out after ${PUBLISH_TIMEOUT_MS}ms`),
        ),
      PUBLISH_TIMEOUT_MS,
    );

    const sendEvent = () => {
      if (eventSent || settled) return;
      eventSent = true;
      ws.send(JSON.stringify(["EVENT", event]));
    };

    ws.addEventListener("open", () => {
      unauthenticatedPublishTimer = setTimeout(sendEvent, 100);
    });

    ws.addEventListener("message", async (message) => {
      let data: unknown;
      try {
        data = JSON.parse(String(message.data));
      } catch {
        return;
      }
      if (!Array.isArray(data)) return;

      if (data[0] === "AUTH" && typeof data[1] === "string") {
        if (unauthenticatedPublishTimer) {
          clearTimeout(unauthenticatedPublishTimer);
          unauthenticatedPublishTimer = null;
        }
        try {
          const authEvent = await signNostrEvent(makeAuthEvent(wsUrl, data[1]));
          if (settled) return;
          authEventId = authEvent.id;
          ws.send(JSON.stringify(["AUTH", authEvent]));
        } catch (error) {
          finish(
            error instanceof Error
              ? error
              : new Error("Failed to sign relay authentication."),
          );
        }
        return;
      }

      if (data[0] !== "OK") return;
      if (data[1] === authEventId) {
        if (data[2] === true) sendEvent();
        else {
          finish(
            new Error(
              typeof data[3] === "string"
                ? data[3]
                : "Relay authentication failed.",
            ),
          );
        }
      } else if (data[1] === event.id) {
        if (data[2] === true) finish();
        else {
          finish(
            new Error(
              typeof data[3] === "string"
                ? data[3]
                : "Relay rejected the event.",
            ),
          );
        }
      }
    });

    ws.addEventListener("error", () => {
      finish(new Error("WebSocket connection failed"));
    });
    ws.addEventListener("close", () => {
      if (!settled)
        finish(new Error("Relay closed before acknowledging event."));
    });
  });
}

type SubscriptionCallbacks = {
  onEvent(event: NostrEvent): void;
  onEose?(): void;
  onError?(error: Error): void;
};

/** Maintain a live NIP-01 subscription until the returned cleanup is called. */
export function subscribeEvents(
  wsUrl: string,
  filter: NostrFilter,
  callbacks: SubscriptionCallbacks,
): () => void {
  const ws = new WebSocket(wsUrl);
  const subId = `live-${Date.now().toString(36)}-${crypto.randomUUID()}`;
  let closedByClient = false;
  let reqSent = false;
  let authEventId: string | null = null;
  let unauthenticatedReqTimer: ReturnType<typeof setTimeout> | null = null;

  const reportError = (error: Error) => {
    if (!closedByClient) callbacks.onError?.(error);
  };
  const sendReq = () => {
    if (reqSent || closedByClient) return;
    reqSent = true;
    ws.send(JSON.stringify(["REQ", subId, filter]));
  };

  ws.addEventListener("open", () => {
    unauthenticatedReqTimer = setTimeout(sendReq, 100);
  });
  ws.addEventListener("message", async (message) => {
    let data: unknown;
    try {
      data = JSON.parse(String(message.data));
    } catch {
      return;
    }
    if (!Array.isArray(data)) return;

    if (data[0] === "AUTH" && typeof data[1] === "string") {
      if (unauthenticatedReqTimer) {
        clearTimeout(unauthenticatedReqTimer);
        unauthenticatedReqTimer = null;
      }
      try {
        const authEvent = await signNostrEvent(makeAuthEvent(wsUrl, data[1]));
        if (closedByClient) return;
        authEventId = authEvent.id;
        ws.send(JSON.stringify(["AUTH", authEvent]));
      } catch (error) {
        reportError(
          error instanceof Error
            ? error
            : new Error("Failed to sign relay authentication."),
        );
        ws.close();
      }
      return;
    }

    if (data[0] === "OK" && data[1] === authEventId) {
      if (data[2] === true) sendReq();
      else {
        reportError(
          new Error(
            typeof data[3] === "string"
              ? data[3]
              : "Relay authentication failed.",
          ),
        );
        ws.close();
      }
    } else if (data[0] === "EVENT" && data[1] === subId && data[2]) {
      callbacks.onEvent(data[2] as NostrEvent);
    } else if (data[0] === "EOSE" && data[1] === subId) {
      callbacks.onEose?.();
    } else if (data[0] === "CLOSED" && data[1] === subId) {
      reportError(
        new Error(
          typeof data[2] === "string"
            ? data[2]
            : "Relay closed the subscription.",
        ),
      );
    }
  });
  ws.addEventListener("error", () => {
    reportError(new Error("WebSocket connection failed"));
  });
  ws.addEventListener("close", () => {
    if (!closedByClient && reqSent) {
      reportError(new Error("Relay subscription disconnected."));
    }
  });

  return () => {
    closedByClient = true;
    if (unauthenticatedReqTimer) clearTimeout(unauthenticatedReqTimer);
    if (reqSent && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(["CLOSE", subId]));
    }
    ws.close();
  };
}
