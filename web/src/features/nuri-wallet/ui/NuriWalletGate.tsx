import { KeyRound, LoaderCircle, WalletCards } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import buzzAppIcon from "@/assets/app-icon@3x.png";
import { lockNuriSigner, unlockNuriSigner } from "@/shared/lib/nostr-signer";
import { Button } from "@/shared/ui/button";
import {
  clearPendingConnectFlow,
  type ConnectFlow,
  readPendingConnectFlow,
  startConnectFlow,
  waitForConnectApproval,
} from "../lib/connect";
import { zeroizeNuriWallet } from "../lib/derive";
import { assertSameNuriWallet } from "../lib/identity";
import { registerNuriMember } from "../lib/register";
import { unlockNuriPasskey } from "../lib/webauthn";

function isLocalPreview(): boolean {
  const local =
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost";
  return local && new URLSearchParams(window.location.search).has("preview");
}

export function NuriWalletGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(isLocalPreview);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const completing = useRef(false);

  const complete = useCallback(async () => {
    const pending = readPendingConnectFlow();
    if (!pending) {
      setError("Connect session not found. Start again.");
      return;
    }
    if (completing.current) return;
    completing.current = true;
    setBusy(true);
    setError("");
    setStatus("Checking Connect approval…");

    try {
      const approved = await waitForConnectApproval(pending);
      setStatus("Unlock the same passkey once for Buzz…");
      const wallet = await unlockNuriPasskey(approved.wallet.cred_id_b64u);
      try {
        assertSameNuriWallet(wallet.public, approved.wallet);
        unlockNuriSigner(wallet.secrets.nostr_private_key);
      } finally {
        zeroizeNuriWallet(wallet);
      }

      setStatus("Creating your Buzz membership…");
      try {
        await registerNuriMember(approved.session_id, pending.flow);
      } catch (registrationError) {
        lockNuriSigner();
        throw registrationError;
      }

      clearPendingConnectFlow();
      window.history.replaceState({}, "", window.location.pathname);
      setUnlocked(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("");
    } finally {
      completing.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const returning =
      new URLSearchParams(window.location.search).get("nuri_connect") ===
      "return";
    if (returning) void complete();
  }, [complete]);

  const start = async (flow: ConnectFlow) => {
    setBusy(true);
    setError("");
    setStatus("Opening Nuri Connect…");
    try {
      const result = await startConnectFlow(flow);
      window.location.assign(result.approval_url);
    } catch (caught) {
      setBusy(false);
      setStatus("");
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  if (unlocked) return children;

  return (
    <div className="flex flex-1 items-center justify-center bg-[#F3F3F3] px-4 py-12 dark:bg-[#171717]">
      <div className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-7 shadow-sm dark:border-white/10 dark:bg-[#202020]">
        <div className="flex items-center gap-3">
          <img alt="Buzz" className="h-12 w-12 rounded-xl" src={buzzAppIcon} />
          <div>
            <h1 className="text-xl font-semibold text-black dark:text-white">
              Nuri Buzz
            </h1>
            <p className="text-sm text-black/55 dark:text-white/55">
              One passkey. Your identity and wallet.
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-xl bg-black/[0.035] p-4 dark:bg-white/[0.05]">
          <div className="flex gap-3">
            <WalletCards className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm leading-6 text-black/70 dark:text-white/70">
              Create or access your Nuri Wallet with Bitcoin, Arkade, Lightning,
              Ethereum and a private Nostr identity for Buzz.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-3">
          <Button
            disabled={busy}
            size="lg"
            onClick={() => void start("create")}
          >
            <WalletCards /> Create Nuri Wallet
          </Button>
          <Button
            disabled={busy}
            size="lg"
            variant="outline"
            onClick={() => void start("access")}
          >
            <KeyRound /> Use existing wallet
          </Button>
          {readPendingConnectFlow() && !busy ? (
            <Button variant="ghost" onClick={() => void complete()}>
              Continue pending Connect session
            </Button>
          ) : null}
        </div>

        {busy ? (
          <p className="mt-5 flex items-center justify-center gap-2 text-sm text-black/60 dark:text-white/60">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {status}
          </p>
        ) : null}
        {error ? (
          <p className="mt-5 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <p className="mt-6 text-center text-xs leading-5 text-black/45 dark:text-white/45">
          Private wallet keys never leave this browser and are erased when this
          tab closes.
        </p>
      </div>
    </div>
  );
}
