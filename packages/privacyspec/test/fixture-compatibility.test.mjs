import assert from "node:assert/strict";
import test from "node:test";
import { disposePlaywrightResources } from "../dist/playwright/fixture.js";

test("legacy Playwright registrations without disposables are ignored", async () => {
  const disposed = [];

  await assert.doesNotReject(
    disposePlaywrightResources([
      undefined,
      {
        async dispose() {
          disposed.push("resolved");
        },
      },
      {
        async dispose() {
          disposed.push("rejected");
          throw new Error("cleanup failed");
        },
      },
    ]),
  );

  assert.deepEqual(disposed, ["resolved", "rejected"]);
});
