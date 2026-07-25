import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import { relayHttpBaseUrl } from "@/shared/lib/relay-url";
import {
  parseSpaceInvite,
  type SpaceInvite,
  type SpaceVisibility,
} from "./space";

export {
  normalizeSpaceSlug,
  parseSpaceInvite,
  spaceHost,
} from "./space";
export type { SpaceInvite, SpaceVisibility } from "./space";

export type NuriSpace = {
  community_id: string;
  name: string;
  slug: string;
  host: string;
  relay_url: string;
  visibility: SpaceVisibility;
  role: string | null;
  is_member: boolean;
  general_channel_id?: string;
};

type SpaceResponse = Omit<NuriSpace, "relay_url" | "is_member"> & {
  relay_url?: string;
  is_member?: boolean;
};

function normalizeSpace(space: SpaceResponse): NuriSpace {
  return {
    ...space,
    relay_url: space.relay_url ?? `wss://${space.host}`,
    is_member: space.is_member ?? space.role !== null,
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const result = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(
      result.message ??
        result.error ??
        `Space request failed (${response.status}).`,
    );
  }
  return result;
}

async function hubRequest<T>(
  path: string,
  method: "GET" | "POST",
  payload?: object,
): Promise<T> {
  const url = `${relayHttpBaseUrl().replace(/\/+$/, "")}${path}`;
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  const authorization = await makeNip98AuthHeader(
    url,
    method,
    body === undefined ? undefined : { body, requireNip07: true },
  );
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: authorization,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body,
  });
  return parseResponse<T>(response);
}

export async function listNuriSpaces(): Promise<NuriSpace[]> {
  const result = await hubRequest<{ spaces: SpaceResponse[] }>(
    "/api/nuri/spaces",
    "GET",
  );
  return result.spaces.map(normalizeSpace);
}

export async function createNuriSpace(input: {
  name: string;
  slug: string;
  visibility: SpaceVisibility;
}): Promise<NuriSpace> {
  return normalizeSpace(
    await hubRequest<SpaceResponse>("/api/nuri/spaces", "POST", input),
  );
}

export async function joinPublicNuriSpace(slug: string): Promise<NuriSpace> {
  return normalizeSpace(
    await hubRequest<SpaceResponse>("/api/nuri/spaces/join", "POST", {
      slug,
    }),
  );
}

type JoinPolicy = {
  terms_markdown?: string;
  privacy_markdown?: string;
  age_attestation_required?: boolean;
  version: string;
};

export async function claimPrivateSpaceInvite(
  inviteUrl: string,
  acceptedPolicy: boolean,
): Promise<SpaceInvite> {
  const invite = parseSpaceInvite(inviteUrl);
  const httpBase = `https://${invite.host}`;
  const policyResponse = await fetch(`${httpBase}/api/join-policy`);
  const { policy } = await parseResponse<{ policy?: JoinPolicy }>(
    policyResponse,
  );

  let policyReceipt: string | undefined;
  if (policy) {
    if (!acceptedPolicy) {
      throw new Error("Accept the Space terms and privacy policy first.");
    }
    const acceptanceBody = JSON.stringify({
      code: invite.code,
      policy_version: policy.version,
      age_confirmed: policy.age_attestation_required ?? false,
    });
    const acceptanceResponse = await fetch(
      `${httpBase}/api/invites/accept-policy`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: acceptanceBody,
      },
    );
    const acceptance = await parseResponse<{ receipt: string }>(
      acceptanceResponse,
    );
    policyReceipt = acceptance.receipt;
  }

  const claimUrl = `${httpBase}/api/invites/claim`;
  const claimBody = JSON.stringify({
    code: invite.code,
    ...(policyReceipt ? { policy_receipt: policyReceipt } : {}),
  });
  const authorization = await makeNip98AuthHeader(claimUrl, "POST", {
    body: claimBody,
    requireNip07: true,
  });
  await parseResponse(
    await fetch(claimUrl, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: claimBody,
    }),
  );
  return invite;
}
