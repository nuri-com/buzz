import { useEffect, useRef, useState } from "react";

import { relayWsUrl } from "./relay-url";
import { type RelayConnection, connectRelay } from "./relay-socket";

const RECONNECT_DELAY_MS = 2_000;

/** One authenticated relay socket for the lifetime of the mounted page. */
export function useRelayConnection() {
  const [connection, setConnection] = useState<RelayConnection | null>(null);
  const [error, setError] = useState("");
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let disposed = false;
    let relay: RelayConnection | null = null;

    const open = () => {
      relay = connectRelay(relayWsUrl(), {
        onOpen: () => {
          if (!disposed) setError("");
        },
        onClose: (reason) => {
          if (disposed) return;
          setConnection(null);
          if (reason) setError(reason);
          reconnectTimer.current = setTimeout(open, RECONNECT_DELAY_MS);
        },
      });
      setConnection(relay);
    };
    open();

    return () => {
      disposed = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      relay?.close();
    };
  }, []);

  return { connection, error, setError };
}
