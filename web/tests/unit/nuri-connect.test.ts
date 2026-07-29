import assert from "node:assert/strict";
import test from "node:test";

import {
  connectReturnUrl,
  matchesConnectReturn,
  validApprovalUrl,
  validSessionId,
} from "../../src/features/nuri-wallet/lib/connect.ts";

const sessionId = "a1".repeat(32);

test("accepts only exact Connect session ids and approval URLs", () => {
  assert.equal(validSessionId(sessionId), true);
  assert.equal(validSessionId("short"), false);
  assert.equal(validSessionId("zz".repeat(32)), false);

  assert.equal(
    validApprovalUrl(
      `https://connect.nuri.com/create/${sessionId}?return_url=x`,
      sessionId,
      "create",
    ),
    true,
  );
  assert.equal(
    validApprovalUrl(
      `https://connect.nuri.com/approve/${sessionId}?return_url=x`,
      sessionId,
      "access",
    ),
    true,
  );
  assert.equal(
    validApprovalUrl(
      `https://connect.nuri.com.evil.test/approve/${sessionId}`,
      sessionId,
      "access",
    ),
    false,
  );
  assert.equal(
    validApprovalUrl(
      `https://connect.nuri.com/create/${sessionId}`,
      sessionId,
      "access",
    ),
    false,
  );

  const pending = {
    flow: "access" as const,
    sessionId,
    returnNonce: "7f7f5a37-605d-4400-96fc-4cd234f8ffcb",
  };
  assert.equal(matchesConnectReturn(pending, pending.returnNonce), true);
  assert.equal(matchesConnectReturn(pending, "attacker-nonce"), false);
  assert.equal(matchesConnectReturn(null, pending.returnNonce), false);
});

test("returns to the page the login started on, not the root", () => {
  assert.equal(
    connectReturnUrl("https://support.nuri.com", "/admin", "nonce-1"),
    "https://support.nuri.com/admin?nuri_connect=nonce-1",
  );
  assert.equal(
    connectReturnUrl("https://support.nuri.com", "/", "nonce-1"),
    "https://support.nuri.com/?nuri_connect=nonce-1",
  );
});

test("drops a stale nuri_connect and hash instead of carrying it along", () => {
  assert.equal(
    connectReturnUrl(
      "https://support.nuri.com",
      "/admin?nuri_connect=stale#section",
      "fresh",
    ),
    "https://support.nuri.com/admin?nuri_connect=fresh",
  );
});
