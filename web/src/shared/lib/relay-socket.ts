/**
 * Persistent NIP-42-authenticated relay socket.
 *
 * `queryEvents` in `nostr-client.ts` is one-shot: it closes at EOSE. Chat needs
 * the socket to stay open so the relay keeps pushing new events into the same
 * subscription, plus an outbound path for publishing.
 */

import { makeAuthEvent } from "nostr-tools/nip42";
import type { NostrFilter } from "./nostr-client";
import {
  type SignedNostrEvent,
  type UnsignedNostrEvent,
  signNostrEvent,
} from "./nostr-signer";

/** Buzz relays always challenge; other relays may not. Flush anyway after this. */
const AUTH_GRACE_MS = 300;
const PUBLISH_TIMEOUT_MS = 15_000;

export type RelaySubscription = {
  onEvent: (event: SignedNostrEvent) => void;
  onEose?: () => void;
  onClosed?: (reason: string) => void;
};

export type RelayConnection = {
  subscribe(filter: NostrFilter, handlers: RelaySubscription): () => void;
  publish(
    template: Omit<UnsignedNostrEvent, "created_at">,
  ): Promise<SignedNostrEvent>;
  close(): void;
};

export function connectRelay(
  wsUrl: string,
  events: { onOpen?: () => void; onClose?: (error?: string) => void } = {},
): RelayConnection {
  const ws = new WebSocket(wsUrl);
  const queued: string[] = [];
  const subs = new Map<string, RelaySubscription>();
  const publishes = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void }
  >();

  let ready = false;
  let closed = false;
  let authEventId: string | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let subCounter = 0;

  const flush = () => {
    if (ready || ws.readyState !== WebSocket.OPEN) return;
    ready = true;
    if (graceTimer) clearTimeout(graceTimer);
    graceTimer = null;
    for (const frame of queued.splice(0)) ws.send(frame);
    events.onOpen?.();
  };

  const send = (frame: unknown[]) => {
    const raw = JSON.stringify(frame);
    if (ready && ws.readyState === WebSocket.OPEN) ws.send(raw);
    else queued.push(raw);
  };

  ws.addEventListener("open", () => {
    graceTimer = setTimeout(flush, AUTH_GRACE_MS);
  });

  ws.addEventListener("message", async (message) => {
    let frame: unknown;
    try {
      frame = JSON.parse(String(message.data));
    } catch {
      return;
    }
    if (!Array.isArray(frame)) return;
    const [type] = frame;

    if (type === "AUTH" && typeof frame[1] === "string") {
      if (graceTimer) clearTimeout(graceTimer);
      graceTimer = null;
      try {
        const signed = await signNostrEvent(makeAuthEvent(wsUrl, frame[1]));
        if (closed) return;
        authEventId = signed.id;
        ws.send(JSON.stringify(["AUTH", signed]));
      } catch (error) {
        events.onClose?.(
          error instanceof Error
            ? error.message
            : "relay authentication failed",
        );
        ws.close();
      }
      return;
    }

    if (type === "OK" && typeof frame[1] === "string") {
      if (frame[1] === authEventId) {
        if (frame[2] === true) flush();
        else {
          events.onClose?.(
            typeof frame[3] === "string"
              ? frame[3]
              : "relay authentication rejected",
          );
          ws.close();
        }
        return;
      }
      const waiting = publishes.get(frame[1]);
      if (waiting) {
        publishes.delete(frame[1]);
        if (frame[2] === true) waiting.resolve();
        else
          waiting.reject(
            new Error(typeof frame[3] === "string" ? frame[3] : "rejected"),
          );
      }
      return;
    }

    if (type === "EVENT" && typeof frame[1] === "string" && frame[2]) {
      subs.get(frame[1])?.onEvent(frame[2] as SignedNostrEvent);
    } else if (type === "EOSE" && typeof frame[1] === "string") {
      subs.get(frame[1])?.onEose?.();
    } else if (type === "CLOSED" && typeof frame[1] === "string") {
      const sub = subs.get(frame[1]);
      subs.delete(frame[1]);
      sub?.onClosed?.(
        typeof frame[2] === "string" ? frame[2] : "subscription closed",
      );
    }
  });

  ws.addEventListener("close", () => {
    closed = true;
    for (const waiting of publishes.values())
      waiting.reject(new Error("relay connection closed"));
    publishes.clear();
    events.onClose?.();
  });

  ws.addEventListener("error", () => {
    if (!closed) events.onClose?.("relay connection failed");
  });

  return {
    subscribe(filter, handlers) {
      subCounter += 1;
      const subId = `s${subCounter}`;
      subs.set(subId, handlers);
      send(["REQ", subId, filter]);
      return () => {
        subs.delete(subId);
        if (!closed) send(["CLOSE", subId]);
      };
    },

    async publish(template) {
      const signed = await signNostrEvent(template);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          publishes.delete(signed.id);
          reject(new Error("relay did not confirm the message"));
        }, PUBLISH_TIMEOUT_MS);
        publishes.set(signed.id, {
          resolve: () => {
            clearTimeout(timer);
            resolve(signed);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        send(["EVENT", signed]);
      });
    },

    close() {
      closed = true;
      ws.close();
    },
  };
}
