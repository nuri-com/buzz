import { Hash, LoaderCircle, SendHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { truncatePubkey } from "@/shared/lib/pubkey";
import { relativeTime } from "@/shared/lib/relative-time";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useChat } from "../use-chat";

export function ChatPage() {
  const {
    channels,
    activeChannel,
    selectChannel,
    messages,
    pubkey,
    error,
    connected,
    send,
  } = useChat();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length === 0) return;
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const submit = async (submitEvent: React.FormEvent) => {
    submitEvent.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await send(text);
      setDraft("");
    } catch (caught) {
      toast.error("Message not delivered", {
        description: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setSending(false);
    }
  };

  if (!channels) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#F3F3F3] dark:bg-[#171717]">
        <p className="flex items-center gap-2 text-sm text-black/60 dark:text-white/60">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          {error || "Connecting to the community…"}
        </p>
      </div>
    );
  }

  if (channels.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#F3F3F3] px-6 text-center dark:bg-[#171717]">
        <p className="max-w-sm text-sm text-black/60 dark:text-white/60">
          No channels are open to you yet. Ask an admin to open a channel for
          this community.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 bg-[#F3F3F3] dark:bg-[#171717]">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-black/10 py-4 dark:border-white/10 sm:flex">
        <h2 className="px-4 pb-2 text-xs font-semibold uppercase tracking-wide text-black/45 dark:text-white/45">
          Channels
        </h2>
        {channels.map((channel) => (
          <button
            key={channel.id}
            type="button"
            onClick={() => selectChannel(channel.id)}
            className={`flex items-center gap-2 px-4 py-1.5 text-left text-sm ${
              channel.id === activeChannel?.id
                ? "bg-black/[0.06] font-medium text-black dark:bg-white/10 dark:text-white"
                : "text-black/70 hover:bg-black/[0.03] dark:text-white/70 dark:hover:bg-white/5"
            }`}
          >
            <Hash className="h-3.5 w-3.5 shrink-0 opacity-60" />
            <span className="truncate">{channel.name}</span>
          </button>
        ))}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-black/10 px-4 py-3 dark:border-white/10">
          <Hash className="h-4 w-4 opacity-60" />
          <span className="font-semibold text-black dark:text-white">
            {activeChannel?.name ?? "—"}
          </span>
          {activeChannel?.about ? (
            <span className="truncate text-sm text-black/50 dark:text-white/50">
              {activeChannel.about}
            </span>
          ) : null}
          {!connected ? (
            <span className="ml-auto text-xs text-amber-600 dark:text-amber-400">
              Reconnecting…
            </span>
          ) : null}
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <p className="text-sm text-black/50 dark:text-white/50">
              No messages yet. Say hello.
            </p>
          ) : (
            <ul className="space-y-3">
              {messages.map((message) => (
                <li key={message.id}>
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`text-sm font-medium ${
                        message.pubkey === pubkey
                          ? "text-black dark:text-white"
                          : "text-black/75 dark:text-white/75"
                      }`}
                    >
                      {message.pubkey === pubkey
                        ? "You"
                        : truncatePubkey(message.pubkey)}
                    </span>
                    <span className="text-xs text-black/40 dark:text-white/40">
                      {relativeTime(message.created_at)}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-base text-black/85 dark:text-white/85">
                    {message.content}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <div ref={bottom} />
        </div>

        <form
          onSubmit={submit}
          className="flex gap-2 border-t border-black/10 p-3 dark:border-white/10"
        >
          <Input
            value={draft}
            onChange={(changeEvent) => setDraft(changeEvent.target.value)}
            placeholder={`Message #${activeChannel?.name ?? ""}`}
            className="flex-1 border-black/10 bg-white text-black placeholder:text-black/40 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-white/40"
          />
          <Button type="submit" disabled={sending || !draft.trim()}>
            {sending ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <SendHorizontal />
            )}
            Send
          </Button>
        </form>
      </section>
    </div>
  );
}
