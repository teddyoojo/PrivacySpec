import assert from "node:assert/strict";
import test from "node:test";

import { canonicalizeEndpointPath, MAX_NORMALIZED_PATH_LENGTH } from "../dist/correlate/redact.js";

test("endpoint canonicalization collapses generic dynamic segment families", () => {
  const pairs = [
    ["/accounts/12345", "/accounts/98765", "/accounts/:number"],
    [
      "/accounts/550e8400-e29b-41d4-a716-446655440000",
      "/accounts/123e4567-e89b-12d3-a456-426614174000",
      "/accounts/:uuid",
    ],
    ["/objects/0123456789abcdef01234567", "/objects/fedcba987654321001234567", "/objects/:id"],
    ["/sessions/Td_vr2mldQB0a2vOshEZ3", "/sessions/Az_4kLmN9pQr2StUvWxY7", "/sessions/:id"],
    ["/jobs/cmt3ab4cd5ef6gh7ij8kl9mn0", "/jobs/cmx9zy8wv7ut6sr5qp4on3ml2", "/jobs/:id"],
    ["/members/q7_amber_forest", "/members/m2_silver_harbor", "/members/:id"],
    ["/members/uy_amber_forest", "/members/nw_silver_harbor", "/members/:id"],
    ["/members/q7_amber_forest.data", "/members/m2_silver_harbor.data", "/members/:id.data"],
  ];

  for (const [left, right, expected] of pairs) {
    assert.equal(canonicalizeEndpointPath(left, []), expected);
    assert.equal(canonicalizeEndpointPath(right, []), expected);
  }
});

test("endpoint canonicalization preserves semantically meaningful static routes", () => {
  const staticPaths = [
    "/api/account-settings",
    "/api/privacy-policy",
    "/api/feature_flags",
    "/api/oauth/callback",
    "/api/v1/reports/daily",
    "/api/notes/new.data",
    "/api/notes/edit.data",
    "/api/webhooks/github",
    "/api/products/enterprise-plan",
    "/api/releases/preview.json",
    "/api/ui_flags",
    "/api/qa_channel",
    "/api/v2_feature_flags",
  ];

  assert.deepEqual(
    staticPaths.map((path) => canonicalizeEndpointPath(path, [])),
    staticPaths,
  );
  assert.equal(
    new Set(staticPaths.map((path) => canonicalizeEndpointPath(path, []))).size,
    staticPaths.length,
  );
});

test("static route vocabularies remain distinct across a broad deterministic sample", () => {
  const prefixes = ["api", "admin", "account", "internal", "v1", "v2", "v3"];
  const concepts = ["account", "feature", "privacy", "release", "security"];
  const qualifiers = ["settings", "flags", "policy", "channel", "status"];
  const paths = prefixes.flatMap((prefix) =>
    concepts.flatMap((concept) =>
      qualifiers.map((qualifier) => `/routes/${prefix}_${concept}_${qualifier}`),
    ),
  );

  const canonical = paths.map((path) => canonicalizeEndpointPath(path, []));
  assert.deepEqual(canonical, paths);
  assert.equal(new Set(canonical).size, paths.length);
});

test("opaque instance IDs collapse across a broad deterministic sample", () => {
  const canonical = new Set();
  for (let index = 0; index < 256; index += 1) {
    const counter = index.toString(36).padStart(6, "0");
    const scrambled = ((index + 1) * 2_654_435_761).toString(36).slice(-8).padStart(8, "0");
    canonical.add(canonicalizeEndpointPath(`/workspaces/c${counter}${scrambled}x9/tasks`, []));
  }

  assert.deepEqual([...canonical], ["/workspaces/:id/tasks"]);
});

test("structured instance handles collapse without erasing their representation", () => {
  const prefixes = ["aa", "b2", "cc", "d4", "ee", "f6", "gg", "h8"];
  const dataEndpoints = prefixes.map((prefix, index) =>
    canonicalizeEndpointPath(`/members/${prefix}_sample_member${index}.data`, []),
  );
  const jsonEndpoints = prefixes.map((prefix, index) =>
    canonicalizeEndpointPath(`/members/${prefix}_sample_member${index}.json`, []),
  );

  assert.deepEqual(new Set(dataEndpoints), new Set(["/members/:id.data"]));
  assert.deepEqual(new Set(jsonEndpoints), new Set(["/members/:id.json"]));
  assert.notEqual(dataEndpoints[0], jsonEndpoints[0]);
});

test("endpoint canonicalization is idempotent, bounded, and privacy preserving", () => {
  const paths = [
    "/",
    "/api/account-settings",
    "/members/q7_amber_forest.data",
    "/jobs/cmt3ab4cd5ef6gh7ij8kl9mn0",
    "/accounts/550e8400-e29b-41d4-a716-446655440000",
  ];
  for (const path of paths) {
    const once = canonicalizeEndpointPath(path, []);
    assert.equal(canonicalizeEndpointPath(once, []), once);
  }

  const secret = "private/path/value";
  const redacted = canonicalizeEndpointPath(`/accounts/${secret}/details`, [secret]);
  assert.equal(redacted.includes(secret), false);
  assert.equal(redacted.includes(":redacted"), true);

  const bounded = canonicalizeEndpointPath("/x".repeat(1_000_000), []);
  assert.equal(bounded.length, MAX_NORMALIZED_PATH_LENGTH);
  assert.equal(bounded.endsWith("/:truncated"), true);
});
