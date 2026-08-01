import {
  ArrowRight,
  Globe2,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  type NuriSpace,
  normalizeSpaceSlug,
  type SpaceVisibility,
} from "@/features/spaces/lib/space-client";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

function SpaceCard({
  space,
  busy,
  onOpen,
}: {
  space: NuriSpace;
  busy: boolean;
  onOpen: () => Promise<void>;
}) {
  const VisibilityIcon = space.visibility === "public" ? Globe2 : LockKeyhole;
  return (
    <button
      className="group flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent/50 disabled:opacity-60"
      disabled={busy}
      onClick={() => void onOpen()}
      type="button"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-base font-semibold text-primary uppercase">
        {space.name.slice(0, 2)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {space.name}
        </span>
        <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <VisibilityIcon className="h-3 w-3" />
          {space.visibility === "public" ? "Public" : "Private"}
          {space.role ? ` · ${space.role}` : ""}
        </span>
      </span>
      {busy ? (
        <LoaderCircle className="h-4 w-4 animate-spin" />
      ) : (
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      )}
    </button>
  );
}

export function SpaceDirectory({
  spaces,
  loading,
  error,
  onReload,
  onOpen,
  onCreate,
  onJoinPublic,
  onClaimInvite,
}: {
  spaces: NuriSpace[];
  loading: boolean;
  error: string;
  onReload: () => Promise<void>;
  onOpen: (space: NuriSpace) => void;
  onCreate: (input: {
    name: string;
    slug: string;
    visibility: SpaceVisibility;
  }) => Promise<void>;
  onJoinPublic: (space: NuriSpace) => Promise<void>;
  onClaimInvite: (url: string, accepted: boolean) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [visibility, setVisibility] = useState<SpaceVisibility>("public");
  const [inviteUrl, setInviteUrl] = useState("");
  const [acceptedPolicy, setAcceptedPolicy] = useState(false);
  const [action, setAction] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    if (!slugEdited) setSlug(normalizeSpaceSlug(name));
  }, [name, slugEdited]);

  const ownSpaces = useMemo(
    () => spaces.filter((space) => space.is_member),
    [spaces],
  );
  const publicSpaces = useMemo(
    () =>
      spaces.filter(
        (space) => !space.is_member && space.visibility === "public",
      ),
    [spaces],
  );

  async function run(label: string, operation: () => Promise<void>) {
    setAction(label);
    setActionError("");
    try {
      await operation();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "The Space request failed.",
      );
    } finally {
      setAction("");
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b bg-card/70 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Nuri Chat</h1>
            <p className="text-sm text-muted-foreground">
              Create a Space or join a public one.
            </p>
          </div>
          <Button
            aria-label="Reload Spaces"
            disabled={loading}
            onClick={() => void onReload()}
            size="icon"
            variant="ghost"
          >
            <RefreshCw className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-8 p-5 lg:grid-cols-[1fr_22rem] lg:p-8">
        <section className="space-y-8">
          <div>
            <h2 className="mb-3 text-base font-semibold">Your Spaces</h2>
            {loading && ownSpaces.length === 0 ? (
              <div className="flex items-center gap-2 rounded-xl border p-5 text-sm text-muted-foreground">
                <LoaderCircle className="h-4 w-4 animate-spin" /> Loading
                Spaces…
              </div>
            ) : ownSpaces.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                You have not joined a Space yet. Create one or join a public
                Space below.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {ownSpaces.map((space) => (
                  <SpaceCard
                    busy={action === space.slug}
                    key={space.community_id}
                    onOpen={async () => onOpen(space)}
                    space={space}
                  />
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <Globe2 className="h-4 w-4" />
              <h2 className="text-base font-semibold">Public Spaces</h2>
            </div>
            {publicSpaces.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                No public Spaces are available yet.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {publicSpaces.map((space) => (
                  <SpaceCard
                    busy={action === space.slug}
                    key={space.community_id}
                    onOpen={() =>
                      run(space.slug, async () => onJoinPublic(space))
                    }
                    space={space}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-5">
          <form
            className="space-y-4 rounded-xl border bg-card p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void run("create", () => onCreate({ name, slug, visibility }));
            }}
          >
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              <h2 className="font-semibold">Create a Space</h2>
            </div>
            <label className="block space-y-1.5 text-sm" htmlFor="space-name">
              <span>Name</span>
              <Input
                autoComplete="organization"
                id="space-name"
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                placeholder="Nuri Builders"
                required
                value={name}
              />
            </label>
            <label className="block space-y-1.5 text-sm" htmlFor="space-slug">
              <span>Address</span>
              <Input
                id="space-slug"
                maxLength={63}
                onChange={(event) => {
                  setSlugEdited(true);
                  setSlug(event.target.value.toLowerCase());
                }}
                pattern="[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
                placeholder="nuri-builders"
                required
                value={slug}
              />
              <span className="block truncate text-xs text-muted-foreground">
                {slug || "space"}.relay.nuri.com
              </span>
            </label>
            <label
              className="block space-y-1.5 text-sm"
              htmlFor="space-visibility"
            >
              <span>Visibility</span>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                id="space-visibility"
                onChange={(event) =>
                  setVisibility(event.target.value as SpaceVisibility)
                }
                value={visibility}
              >
                <option value="public">Public — anyone can join</option>
                <option value="private">Private — invite required</option>
              </select>
            </label>
            <Button className="w-full" disabled={action !== ""} type="submit">
              {action === "create" ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Plus />
              )}
              Create Space
            </Button>
          </form>

          <form
            className="space-y-4 rounded-xl border bg-card p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void run("invite", () =>
                onClaimInvite(inviteUrl, acceptedPolicy),
              );
            }}
          >
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              <h2 className="font-semibold">Private invite</h2>
            </div>
            <Input
              aria-label="Private Space invite URL"
              onChange={(event) => setInviteUrl(event.target.value)}
              placeholder="https://space.relay.nuri.com/invite/…"
              required
              type="url"
              value={inviteUrl}
            />
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                checked={acceptedPolicy}
                className="mt-0.5"
                onChange={(event) => setAcceptedPolicy(event.target.checked)}
                type="checkbox"
              />
              I accept the Space terms and privacy policy, when configured.
            </label>
            <Button
              className="w-full"
              disabled={action !== ""}
              type="submit"
              variant="outline"
            >
              {action === "invite" ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <KeyRound />
              )}
              Join with invite
            </Button>
          </form>

          {(error || actionError) && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {actionError || error}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
