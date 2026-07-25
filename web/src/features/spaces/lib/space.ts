const SPACE_RELAY_SUFFIX = ".relay.nuri.com";
const SPACE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type SpaceVisibility = "public" | "private";

export type SpaceInvite = {
  code: string;
  host: string;
  relayUrl: string;
  slug: string;
};

export function normalizeSpaceSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function spaceHost(slug: string): string {
  if (!SPACE_SLUG_PATTERN.test(slug)) {
    throw new Error("Invalid Space slug.");
  }
  return `${slug}${SPACE_RELAY_SUFFIX}`;
}

export function parseSpaceInvite(value: string): SpaceInvite {
  try {
    const url = new URL(value.trim());
    const suffixIndex = url.hostname.length - SPACE_RELAY_SUFFIX.length;
    const slug = url.hostname.slice(0, suffixIndex);
    const path = url.pathname.match(/^\/invite\/([^/]+)$/);
    if (
      url.protocol !== "https:" ||
      suffixIndex <= 0 ||
      slug.includes(".") ||
      spaceHost(slug) !== url.hostname ||
      !path ||
      url.search ||
      url.hash
    ) {
      throw new Error("invalid");
    }
    return {
      code: decodeURIComponent(path[1]),
      host: url.hostname,
      relayUrl: `wss://${url.hostname}`,
      slug,
    };
  } catch {
    throw new Error("Invalid Space invite URL.");
  }
}
