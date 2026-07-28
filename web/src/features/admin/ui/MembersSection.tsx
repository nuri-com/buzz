import { Link2, LoaderCircle, UserMinus, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { RelayConnection } from "@/shared/lib/relay-socket";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { mintInviteLink } from "../invite";
import { isPubkeyHex } from "../members";
import { useMembers } from "../use-members";

export function MembersSection({
  connection,
  onError,
}: {
  connection: RelayConnection | null;
  onError: (reason: string) => void;
}) {
  const { members, addMember, setRole, removeMember } = useMembers(
    connection,
    onError,
  );
  const [pubkey, setPubkey] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [busy, setBusy] = useState("");

  const run = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
    } catch (caught) {
      toast.error("The relay rejected this change", {
        description: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="mt-10">
      <h2 className="font-medium text-black dark:text-white">Members</h2>

      <div className="mt-3 grid gap-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
        <Button
          variant="outline"
          disabled={busy === "invite"}
          onClick={() =>
            void run("invite", async () => {
              const url = await mintInviteLink();
              setInviteUrl(url);
            })
          }
        >
          {busy === "invite" ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <Link2 />
          )}
          Create invite link
        </Button>
        {inviteUrl ? (
          <div className="grid gap-2">
            <Input
              readOnly
              value={inviteUrl}
              onFocus={(e) => e.target.select()}
            />
            <p className="text-xs text-black/55 dark:text-white/55">
              This link grants the <strong>member</strong> role. To make someone
              an admin, promote them below once they have joined.
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex gap-2">
        <Input
          value={pubkey}
          onChange={(changeEvent) => setPubkey(changeEvent.target.value)}
          placeholder="Add by pubkey (64 hex chars)"
          className="flex-1"
        />
        <Button
          variant="outline"
          disabled={!isPubkeyHex(pubkey) || busy === "add"}
          onClick={() =>
            void run("add", async () => {
              await addMember(pubkey, "member");
              setPubkey("");
            })
          }
        >
          {busy === "add" ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <UserPlus />
          )}
          Add
        </Button>
      </div>

      {!members ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-black/60 dark:text-white/60">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Loading members…
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-black/10 dark:divide-white/10">
          {members.map((member) => (
            <li
              key={member.pubkey}
              className="flex items-center gap-3 py-3 text-sm"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-black dark:text-white">
                {truncatePubkey(member.pubkey)}
              </span>
              <span className="text-black/50 dark:text-white/50">
                {member.role}
              </span>
              {member.role === "owner" ? (
                // The relay refuses every role change on the owner; showing
                // buttons that always fail would be a lie.
                <span className="text-xs text-black/40 dark:text-white/40">
                  set via RELAY_OWNER_PUBKEY
                </span>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === member.pubkey}
                    onClick={() =>
                      void run(member.pubkey, () =>
                        setRole(
                          member.pubkey,
                          member.role === "admin" ? "member" : "admin",
                        ),
                      )
                    }
                  >
                    Make {member.role === "admin" ? "member" : "admin"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy === member.pubkey}
                    onClick={() =>
                      void run(member.pubkey, () => removeMember(member.pubkey))
                    }
                  >
                    <UserMinus />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
