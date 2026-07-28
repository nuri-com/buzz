import { Link } from "@tanstack/react-router";
import { Hash, LoaderCircle, Lock, Unlock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { ChannelVisibility } from "@/features/chat/channels";
import { useRelayConnection } from "@/shared/lib/use-relay-connection";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useChannelAdmin } from "../use-channel-admin";
import { MembersSection } from "./MembersSection";

export function AdminPage() {
  const { connection, error, setError } = useRelayConnection();
  const { channels, createChannel, setVisibility } = useChannelAdmin(
    connection,
    setError,
  );
  const connected = connection !== null;
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [visibility, setVisibilityChoice] = useState<ChannelVisibility>("open");
  const [busy, setBusy] = useState("");

  const run = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
    } catch (caught) {
      // A non-owner lands here: the relay answered OK false.
      toast.error("The relay rejected this change", {
        description: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setBusy("");
    }
  };

  const submit = (submitEvent: React.FormEvent) => {
    submitEvent.preventDefault();
    if (!name.trim()) return;
    void run("create", async () => {
      await createChannel({ name, about, visibility });
      toast.success(`Channel #${name.trim()} created`);
      setName("");
      setAbout("");
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-black dark:text-white">
          Channel admin
        </h1>
        <Link to="/" className="text-sm underline">
          Back to chat
        </Link>
      </header>
      <p className="mt-2 text-sm text-black/60 dark:text-white/60">
        Every change here is a signed Nostr event. The relay decides — if you
        are not an owner it is rejected, and nothing on this page changes that.
      </p>

      <form
        onSubmit={submit}
        className="mt-8 grid gap-3 rounded-xl border border-black/10 p-4 dark:border-white/10"
      >
        <h2 className="font-medium text-black dark:text-white">New channel</h2>
        <Input
          value={name}
          onChange={(changeEvent) => setName(changeEvent.target.value)}
          placeholder="Name, e.g. support"
        />
        <Input
          value={about}
          onChange={(changeEvent) => setAbout(changeEvent.target.value)}
          placeholder="Description (optional)"
        />
        <select
          value={visibility}
          onChange={(changeEvent) =>
            setVisibilityChoice(changeEvent.target.value as ChannelVisibility)
          }
          aria-label="Channel visibility"
          className="rounded-md border border-black/10 bg-white px-3 py-2 text-sm text-black dark:border-white/10 dark:bg-white/5 dark:text-white"
        >
          <option value="open">
            Open — every logged-in user can read + post
          </option>
          <option value="private">Private — members only</option>
        </select>
        <Button type="submit" disabled={!name.trim() || busy === "create"}>
          {busy === "create" ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <Hash />
          )}
          Create channel
        </Button>
      </form>

      <h2 className="mt-8 font-medium text-black dark:text-white">Channels</h2>
      {error ? (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
      {!channels ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-black/60 dark:text-white/60">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Loading…
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-black/10 dark:divide-white/10">
          {channels.map((channel) => (
            <li
              key={channel.id}
              className="flex items-center gap-3 py-3 text-sm"
            >
              <Hash className="h-4 w-4 shrink-0 opacity-50" />
              <span className="min-w-0 flex-1 truncate text-black dark:text-white">
                {channel.name}
              </span>
              <span className="text-black/50 dark:text-white/50">
                {channel.visibility}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!connected || busy === channel.id}
                onClick={() =>
                  void run(channel.id, () =>
                    setVisibility(
                      channel.id,
                      channel.visibility === "open" ? "private" : "open",
                    ),
                  )
                }
              >
                {busy === channel.id ? (
                  <LoaderCircle className="animate-spin" />
                ) : channel.visibility === "open" ? (
                  <Lock />
                ) : (
                  <Unlock />
                )}
                Make {channel.visibility === "open" ? "private" : "open"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <MembersSection connection={connection} onError={setError} />
    </div>
  );
}
