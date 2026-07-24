import assert from "node:assert/strict";
import test from "node:test";

import {
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
});
