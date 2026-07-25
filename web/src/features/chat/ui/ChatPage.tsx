import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  FolderGit2,
  Hash,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  Send,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import buzzAppIcon from "@/assets/app-icon@3x.png";
import {
  joinChatChannel,
  loadChatCatalog,
  loadChatMessages,
  sendChatMessage,
  subscribeToChatChannel,
  type ChatCatalog,
} from "@/features/chat/lib/chat-client";
import { mergeChatMessages } from "@/features/chat/lib/chat";
import type { NostrEvent } from "@/shared/lib/nostr-client";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";

type TimelineState = {
  channelId: string | null;
  events: NostrEvent[];
  loading: boolean;
  error: string;
};

const EMPTY_TIMELINE: TimelineState = {
  channelId: null,
  events: [],
  loading: false,
  error: "",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function messageTime(createdAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(createdAt * 1_000));
}

function MessageRow({
  event,
  ownPubkey,
}: {
  event: NostrEvent;
  ownPubkey: string;
}) {
  const own = event.pubkey === ownPubkey;
  const author = own ? "You" : truncatePubkey(event.pubkey);
  return (
    <article className="group flex gap-3 px-4 py-3 hover:bg-black/[0.025] dark:hover:bg-white/[0.025] sm:px-6">
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-xs font-semibold text-primary">
        {author.substring(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground">
            {author}
          </span>
          <time className="text-xs text-muted-foreground">
            {messageTime(event.created_at)}
          </time>
        </div>
        <div className="prose prose-sm mt-0.5 max-w-none break-words text-foreground prose-a:text-primary prose-code:text-foreground dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {event.content}
          </ReactMarkdown>
        </div>
      </div>
    </article>
  );
}

export function ChatPage({
  relayUrl,
  spaceName,
  bootstrapGeneralChannelId,
  onBackToSpaces,
}: {
  relayUrl: string;
  spaceName: string;
  bootstrapGeneralChannelId?: string;
  onBackToSpaces?: () => void;
}) {
  const [catalog, setCatalog] = useState<ChatCatalog | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [joiningChannelId, setJoiningChannelId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineState>(EMPTY_TIMELINE);
  const [connectionError, setConnectionError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const catalogRequest = useRef<Promise<ChatCatalog> | null>(null);
  const timelineEnd = useRef<HTMLDivElement>(null);

  const refreshCatalog = useCallback(
    async (force = false) => {
      setCatalogLoading(true);
      setCatalogError("");
      if (force || !catalogRequest.current) {
        catalogRequest.current = loadChatCatalog(
          relayUrl,
          bootstrapGeneralChannelId,
        );
      }
      try {
        const loaded = await catalogRequest.current;
        setCatalog(loaded);
        setActiveChannelId((current) => {
          if (loaded.channels.some((channel) => channel.id === current)) {
            return current;
          }
          return (
            loaded.channels.find((channel) => channel.isMember)?.id ??
            loaded.channels[0]?.id ??
            null
          );
        });
      } catch (error) {
        setCatalogError(errorMessage(error));
      } finally {
        setCatalogLoading(false);
      }
    },
    [bootstrapGeneralChannelId, relayUrl],
  );

  useEffect(() => {
    catalogRequest.current = null;
    setCatalog(null);
    setActiveChannelId(null);
    void refreshCatalog(true);
  }, [refreshCatalog]);

  const activeChannel = useMemo(
    () =>
      catalog?.channels.find((channel) => channel.id === activeChannelId) ??
      null,
    [activeChannelId, catalog],
  );

  useEffect(() => {
    if (!activeChannel?.isMember) {
      setTimeline(EMPTY_TIMELINE);
      return;
    }
    let cancelled = false;
    setConnectionError("");
    setTimeline({
      channelId: activeChannel.id,
      events: [],
      loading: true,
      error: "",
    });

    const closeSubscription = subscribeToChatChannel(
      activeChannel.id,
      (event) => {
        if (cancelled) return;
        setTimeline((current) =>
          current.channelId === activeChannel.id
            ? {
                ...current,
                events: mergeChatMessages(current.events, [event]),
              }
            : current,
        );
      },
      (error) => {
        if (!cancelled) setConnectionError(error.message);
      },
      relayUrl,
    );

    void loadChatMessages(activeChannel.id, relayUrl)
      .then((events) => {
        if (cancelled) return;
        setTimeline((current) =>
          current.channelId === activeChannel.id
            ? {
                ...current,
                events: mergeChatMessages(current.events, events),
                loading: false,
              }
            : current,
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setTimeline({
          channelId: activeChannel.id,
          events: [],
          loading: false,
          error: errorMessage(error),
        });
      });

    return () => {
      cancelled = true;
      closeSubscription();
    };
  }, [activeChannel, relayUrl]);

  const latestMessageId = timeline.events[timeline.events.length - 1]?.id;
  useEffect(() => {
    if (latestMessageId) {
      timelineEnd.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [latestMessageId]);

  const join = async () => {
    if (!activeChannel || joiningChannelId) return;
    setJoiningChannelId(activeChannel.id);
    setCatalogError("");
    try {
      await joinChatChannel(activeChannel.id, relayUrl);
      catalogRequest.current = null;
      await refreshCatalog(true);
      setActiveChannelId(activeChannel.id);
    } catch (error) {
      setCatalogError(errorMessage(error));
    } finally {
      setJoiningChannelId(null);
    }
  };

  const send = async () => {
    if (!activeChannel?.isMember || sending || !draft.trim()) return;
    setSending(true);
    setConnectionError("");
    try {
      const sent = await sendChatMessage(activeChannel.id, draft, relayUrl);
      setTimeline((current) => ({
        ...current,
        events: mergeChatMessages(current.events, [sent]),
      }));
      setDraft("");
    } catch (error) {
      setConnectionError(errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="flex min-h-dvh flex-1 flex-col bg-background md:flex-row"
      data-testid="chat-shell"
    >
      <aside className="flex shrink-0 flex-col border-b bg-sidebar md:w-64 md:border-r md:border-b-0">
        <div className="flex h-16 items-center gap-3 border-b px-4">
          {onBackToSpaces ? (
            <Button
              aria-label="Back to Spaces"
              onClick={onBackToSpaces}
              size="icon"
              variant="ghost"
            >
              <ArrowLeft />
            </Button>
          ) : (
            <img alt="Buzz" className="h-9 w-9 rounded-lg" src={buzzAppIcon} />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{spaceName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {new URL(relayUrl).host}
            </p>
          </div>
          <Button
            aria-label="Refresh channels"
            onClick={() => void refreshCatalog(true)}
            size="icon"
            variant="ghost"
          >
            <RefreshCw className={catalogLoading ? "animate-spin" : ""} />
          </Button>
        </div>

        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            General
          </p>
          <Link
            className="text-muted-foreground hover:text-foreground"
            title="Repositories"
            to="/repos"
          >
            <FolderGit2 className="h-4 w-4" />
          </Link>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-2 pb-3 md:flex-1 md:flex-col md:overflow-y-auto">
          {catalog?.channels.map((channel) => (
            <button
              className={`flex min-w-40 items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors md:min-w-0 ${
                channel.id === activeChannelId
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
              }`}
              key={channel.id}
              onClick={() => setActiveChannelId(channel.id)}
              type="button"
            >
              <Hash className="h-4 w-4 shrink-0" />
              <span className="truncate">{channel.name}</span>
              {!channel.isMember ? (
                <span className="ml-auto text-xs text-muted-foreground">
                  Join
                </span>
              ) : null}
            </button>
          ))}
          {!catalogLoading && catalog?.channels.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              No channels available yet.
            </p>
          ) : null}
        </nav>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b px-4 sm:px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Hash className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">
              {activeChannel?.name ?? "Chat"}
            </h1>
            <p className="text-xs text-muted-foreground">
              {activeChannel?.isMember
                ? "Connected to Buzz relay"
                : "Choose or join a channel"}
            </p>
          </div>
        </header>

        {catalogLoading && !catalog ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="h-5 w-5 animate-spin" /> Loading channels…
          </div>
        ) : catalogError ? (
          <div className="m-6 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {catalogError}
          </div>
        ) : !activeChannel ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <MessageCircle className="h-10 w-10 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">No chat channel yet</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              An administrator needs to create the first open channel.
            </p>
          </div>
        ) : !activeChannel.isMember ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <Hash className="h-10 w-10 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">
              Join #{activeChannel.name}
            </h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Join this open channel to read and send messages.
            </p>
            <Button
              className="mt-5"
              disabled={joiningChannelId === activeChannel.id}
              onClick={() => void join()}
            >
              {joiningChannelId === activeChannel.id ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Hash />
              )}
              Join channel
            </Button>
          </div>
        ) : (
          <>
            {connectionError ? (
              <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive sm:px-6">
                {connectionError}
              </div>
            ) : null}
            <div
              className="min-h-0 flex-1 overflow-y-auto py-3"
              data-testid="message-list"
            >
              {timeline.loading ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle className="h-5 w-5 animate-spin" /> Loading
                  messages…
                </div>
              ) : timeline.error ? (
                <p className="px-6 py-8 text-center text-sm text-destructive">
                  {timeline.error}
                </p>
              ) : timeline.events.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <MessageCircle className="h-10 w-10 text-muted-foreground" />
                  <h2 className="mt-4 text-lg font-semibold">
                    Start #{activeChannel.name}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Send the first message to this channel.
                  </p>
                </div>
              ) : (
                timeline.events.map((event) => (
                  <MessageRow
                    event={event}
                    key={event.id}
                    ownPubkey={catalog?.pubkey ?? ""}
                  />
                ))
              )}
              <div ref={timelineEnd} />
            </div>

            <div className="shrink-0 border-t p-3 sm:p-4">
              <div className="mx-auto flex max-w-4xl items-end gap-2 rounded-xl border bg-card p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring">
                <textarea
                  aria-label={`Message #${activeChannel.name}`}
                  className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  placeholder={`Message #${activeChannel.name}`}
                  rows={1}
                  value={draft}
                />
                <Button
                  aria-label="Send message"
                  disabled={sending || !draft.trim()}
                  onClick={() => void send()}
                  size="icon"
                >
                  {sending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Send />
                  )}
                </Button>
              </div>
              <p className="mt-1.5 text-center text-xs text-muted-foreground">
                Enter to send · Shift+Enter for a new line
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
