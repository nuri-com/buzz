import { Compass, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ChatPage } from "@/features/chat/ui/ChatPage";
import {
  claimPrivateSpaceInvite,
  createNuriSpace,
  joinPublicNuriSpace,
  listNuriSpaces,
  type NuriSpace,
  type SpaceVisibility,
} from "@/features/spaces/lib/space-client";
import { SpaceDirectory } from "@/features/spaces/ui/SpaceDirectory";
import { Button } from "@/shared/ui/button";

const ACTIVE_SPACE_KEY = "nuri-chat-active-space-v1";

export function SpacesPage() {
  const [spaces, setSpaces] = useState<NuriSpace[]>([]);
  const [selectedSpace, setSelectedSpace] = useState<NuriSpace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadSpaces = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const loaded = await listNuriSpaces();
      setSpaces(loaded);
      return loaded;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load Spaces.",
      );
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadSpaces().then((loaded) => {
      if (cancelled) return;
      const remembered = localStorage.getItem(ACTIVE_SPACE_KEY);
      const match = loaded.find(
        (space) => space.community_id === remembered && space.is_member,
      );
      if (match) setSelectedSpace(match);
    });
    return () => {
      cancelled = true;
    };
  }, [loadSpaces]);

  const memberSpaces = useMemo(
    () => spaces.filter((space) => space.is_member),
    [spaces],
  );

  function openSpace(space: NuriSpace) {
    localStorage.setItem(ACTIVE_SPACE_KEY, space.community_id);
    setSelectedSpace(space);
  }

  function openDirectory() {
    localStorage.removeItem(ACTIVE_SPACE_KEY);
    setSelectedSpace(null);
  }

  async function createSpace(input: {
    name: string;
    slug: string;
    visibility: SpaceVisibility;
  }) {
    const created = await createNuriSpace(input);
    setSpaces((current) => [
      created,
      ...current.filter((space) => space.community_id !== created.community_id),
    ]);
    openSpace(created);
  }

  async function joinPublic(space: NuriSpace) {
    const joined = await joinPublicNuriSpace(space.slug);
    setSpaces((current) =>
      current.map((candidate) =>
        candidate.community_id === joined.community_id ? joined : candidate,
      ),
    );
    openSpace(joined);
  }

  async function claimInvite(url: string, acceptedPolicy: boolean) {
    const invite = await claimPrivateSpaceInvite(url, acceptedPolicy);
    const loaded = await loadSpaces();
    const joined = loaded.find(
      (space) => space.slug === invite.slug && space.is_member,
    );
    if (!joined) {
      throw new Error(
        "Invite was accepted, but the Space is not in the directory.",
      );
    }
    openSpace(joined);
  }

  if (!selectedSpace) {
    return (
      <SpaceDirectory
        error={error}
        loading={loading}
        onClaimInvite={claimInvite}
        onCreate={createSpace}
        onJoinPublic={joinPublic}
        onOpen={openSpace}
        onReload={async () => {
          await loadSpaces();
        }}
        spaces={spaces}
      />
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-16 shrink-0 flex-col items-center gap-2 border-r bg-card py-3">
        <Button
          aria-label="Browse Spaces"
          onClick={openDirectory}
          size="icon"
          title="Browse Spaces"
          variant="ghost"
        >
          <Compass />
        </Button>
        <div className="my-1 h-px w-8 bg-border" />
        {memberSpaces.map((space) => (
          <button
            aria-label={space.name}
            className={`flex h-10 w-10 items-center justify-center rounded-xl text-xs font-semibold uppercase transition-all ${
              space.community_id === selectedSpace.community_id
                ? "rounded-lg bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:rounded-lg hover:bg-accent hover:text-accent-foreground"
            }`}
            key={space.community_id}
            onClick={() => openSpace(space)}
            title={space.name}
            type="button"
          >
            {space.name.slice(0, 2)}
          </button>
        ))}
        <Button
          aria-label="Create or join a Space"
          className="mt-1 rounded-xl"
          onClick={openDirectory}
          size="icon"
          title="Create or join a Space"
          variant="outline"
        >
          <Plus />
        </Button>
      </aside>
      <div className="min-w-0 flex-1">
        <ChatPage
          bootstrapGeneralChannelId={selectedSpace.general_channel_id}
          onBackToSpaces={openDirectory}
          relayUrl={selectedSpace.relay_url}
          spaceName={selectedSpace.name}
        />
      </div>
    </div>
  );
}
