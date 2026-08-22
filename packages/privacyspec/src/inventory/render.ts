import { createBaselineKey, isBaselineEligibleIdentity } from "../baseline/compare.js";
import type { BaselineFlowIdentity } from "../baseline/schema.js";
import type { InventoryEntry, InventoryFormat, PrivacyInventory } from "./model.js";

const STATIC_ASSET_PREFIXES = ["/assets/", "/build/", "/static/", "/_next/static/"] as const;

const isStaticAssetReferer = (entry: InventoryEntry): boolean =>
  entry.boundary === "FIRST_PARTY" &&
  entry.sinkKind === "request-header" &&
  entry.location === "header.referer" &&
  entry.endpoint !== undefined &&
  STATIC_ASSET_PREFIXES.some((prefix) => entry.endpoint?.startsWith(prefix));

const presentationEntries = (inventory: PrivacyInventory) => {
  const staticAssetReferers = inventory.entries.filter(isStaticAssetReferer);
  return {
    entries:
      staticAssetReferers.length > 1
        ? inventory.entries.filter((entry) => !isStaticAssetReferer(entry))
        : inventory.entries,
    staticAssetReferers: staticAssetReferers.length > 1 ? staticAssetReferers : [],
  };
};

const reviewRuleId = (entry: InventoryEntry): BaselineFlowIdentity["ruleId"] | undefined => {
  if (!entry.dataCategory.startsWith("personal.")) return undefined;
  if (entry.sinkKind === "request-url" || entry.location?.startsWith("url.") === true) {
    return "PS1001";
  }
  if (entry.boundary === "EXTERNAL" && entry.sinkKind === "external-request") return "PS1004";
  if (["local-storage", "session-storage", "cookie"].includes(entry.sinkKind)) return "PS1005";
  return undefined;
};

const reviewDecisionCount = (inventory: PrivacyInventory): number => {
  const keys = new Set<string>();
  for (const entry of inventory.entries) {
    if (entry.state !== "KNOWN_REVIEW" && entry.state !== "NEW_REVIEW") continue;
    const ruleId = reviewRuleId(entry);
    if (ruleId === undefined) continue;
    for (const transform of entry.transforms) {
      const identity: BaselineFlowIdentity = {
        ruleId,
        dataCategory: entry.dataCategory,
        sinkKind: entry.sinkKind,
        transform,
      };
      if (entry.recipient !== undefined) identity.recipient = entry.recipient.origin;
      if (entry.endpoint !== undefined) identity.endpoint = entry.endpoint;
      if (entry.location !== undefined) identity.location = entry.location;
      if (isBaselineEligibleIdentity(identity)) keys.add(createBaselineKey(identity));
    }
  }
  return keys.size;
};

const reviewSummary = (inventory: PrivacyInventory): string | undefined => {
  const rows = inventory.summary.byState.KNOWN_REVIEW + inventory.summary.byState.NEW_REVIEW;
  if (rows === 0) return undefined;
  const decisions = reviewDecisionCount(inventory);
  return `${decisions} review ${decisions === 1 ? "decision" : "decisions"} / ${rows} observed inventory ${rows === 1 ? "row" : "rows"}`;
};

const requestLabel = (entry: InventoryEntry): string =>
  [entry.method, entry.recipient?.origin, entry.endpoint, entry.location]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join(" :: ");

const visibleTestList = (tests: InventoryEntry["tests"], testsTruncated: number): string => {
  const labels = tests.slice(0, 3).map((test) => `${test.title} (${test.file})`);
  const hidden = tests.length - labels.length + testsTruncated;
  return `${labels.join("; ")}${hidden > 0 ? `; +${hidden} more` : ""}`;
};

const visibleTests = (entry: InventoryEntry): string =>
  visibleTestList(entry.tests, entry.testsTruncated);

const sourceProvenanceLabel = (entry: InventoryEntry): string | undefined => {
  const source = entry.sourceProvenance;
  if (source === undefined) return undefined;
  return `${source.origin}${source.endpoint} :: ${source.location}`;
};

const inventorySummary = (inventory: PrivacyInventory): string =>
  `${inventory.summary.entries} ${inventory.summary.entries === 1 ? "entry" : "entries"}, ${inventory.summary.occurrences} flow ${inventory.summary.occurrences === 1 ? "occurrence" : "occurrences"}, ${inventory.summary.categories} ${inventory.summary.categories === 1 ? "category" : "categories"}, ${inventory.summary.externalRecipients} external ${inventory.summary.externalRecipients === 1 ? "recipient" : "recipients"}`;

export const renderInventoryTerminal = (inventory: PrivacyInventory): string => {
  const presentation = presentationEntries(inventory);
  const lines = [
    "PrivacySpec Runtime Privacy Inventory",
    "",
    `Source run: ${inventory.sourceReport.complete ? "COMPLETE" : "INCOMPLETE"} (${inventory.sourceReport.status.toUpperCase()})`,
    `Generated: ${inventory.sourceReport.generatedAt}`,
    `Projects: ${inventory.sourceReport.projects.join(", ") || "none recorded"}`,
    `Observed scope: ${inventory.sourceReport.tests.observed}/${inventory.sourceReport.tests.total} test attempts`,
    `Inventory: ${inventorySummary(inventory)}`,
  ];
  const reviews = reviewSummary(inventory);
  if (reviews !== undefined) lines.push(`Review scope: ${reviews}`);

  if (presentation.staticAssetReferers.length > 0) {
    const entries = presentation.staticAssetReferers;
    const occurrences = entries.reduce((total, entry) => total + entry.occurrences, 0);
    const categories = Array.from(new Set(entries.map((entry) => entry.dataCategory))).sort();
    const sources = Array.from(new Set(entries.flatMap((entry) => entry.sourceKinds))).sort();
    const transforms = Array.from(new Set(entries.flatMap((entry) => entry.transforms))).sort();
    const tests = Array.from(
      new Map(
        entries.flatMap((entry) =>
          entry.tests.map((test) => [JSON.stringify([test.file, test.title, test.project]), test]),
        ),
      ).values(),
    );
    lines.push(
      "",
      "Summarized fan-out",
      "- OBSERVED FIRST_PARTY request-header :: static-asset Referer fan-out :: header.referer",
      `  ${entries.length} static-asset Referer inventory rows summarized; endpoints=${new Set(entries.map((entry) => entry.endpoint)).size}; occurrences=${occurrences}; categories=${categories.join(",")}`,
      `  sources=${sources.join(",")}; transforms=${transforms.join(",")}`,
      `  tests: ${visibleTestList(tests, 0)}`,
    );
  }

  let previousCategory: string | undefined;
  for (const entry of presentation.entries) {
    if (entry.dataCategory !== previousCategory) {
      lines.push("", entry.dataCategory);
      previousCategory = entry.dataCategory;
    }
    const change = entry.changeReasons.length === 0 ? "" : ` [${entry.changeReasons.join(", ")}]`;
    lines.push(
      `- ${entry.state}${change} ${entry.boundary} ${entry.sinkKind}${requestLabel(entry) ? ` :: ${requestLabel(entry)}` : ""}`,
      `  occurrences=${entry.occurrences}; sources=${entry.sourceKinds.join(",")}; transforms=${entry.transforms.join(",")}`,
    );
    const provenance = sourceProvenanceLabel(entry);
    if (provenance !== undefined) lines.push(`  response source: ${provenance}`);
    lines.push(`  tests: ${visibleTests(entry) || "none recorded"}`);
  }

  if (inventory.entries.length === 0) lines.push("", "No supported data flows were observed.");
  if (inventory.resolved.length > 0) {
    lines.push("", `Resolved baseline candidates: ${inventory.resolved.length}`);
    for (const flow of inventory.resolved) {
      lines.push(
        `- ${flow.ruleId} ${flow.dataCategory} -> ${flow.sinkKind}${flow.recipient ? ` :: ${flow.recipient}` : ""}${flow.endpoint ? ` :: ${flow.endpoint}` : ""}${flow.location ? ` :: ${flow.location}` : ""}`,
      );
    }
  }
  lines.push("", "Limitations:");
  for (const limitation of inventory.limitations) lines.push(`- ${limitation}`);
  return `${lines.join("\n")}\n`;
};

const markdownCell = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("\n", " ");

export const renderInventoryMarkdown = (inventory: PrivacyInventory): string => {
  const presentation = presentationEntries(inventory);
  const lines = [
    "# PrivacySpec Runtime Privacy Inventory",
    "",
    `- Source run: **${inventory.sourceReport.complete ? "COMPLETE" : "INCOMPLETE"}** (${inventory.sourceReport.status.toUpperCase()})`,
    `- Generated: ${inventory.sourceReport.generatedAt}`,
    `- Projects: ${inventory.sourceReport.projects.join(", ") || "none recorded"}`,
    `- Observed scope: ${inventory.sourceReport.tests.observed}/${inventory.sourceReport.tests.total} test attempts`,
    `- Inventory: ${inventorySummary(inventory)}`,
  ];
  const reviews = reviewSummary(inventory);
  if (reviews !== undefined) lines.push(`- Review scope: ${reviews}`);
  lines.push(
    "",
    "| Category | Boundary | Sink | Request/location | Sources | Transforms | State | Change | Occurrences | Tests |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- |",
  );
  if (presentation.staticAssetReferers.length > 0) {
    const entries = presentation.staticAssetReferers;
    const occurrences = entries.reduce((total, entry) => total + entry.occurrences, 0);
    const categories = Array.from(new Set(entries.map((entry) => entry.dataCategory))).sort();
    const sources = Array.from(new Set(entries.flatMap((entry) => entry.sourceKinds))).sort();
    const transforms = Array.from(new Set(entries.flatMap((entry) => entry.transforms))).sort();
    const tests = Array.from(
      new Map(
        entries.flatMap((entry) =>
          entry.tests.map((test) => [JSON.stringify([test.file, test.title, test.project]), test]),
        ),
      ).values(),
    );
    lines.push(
      `| ${categories.join(", ")} | FIRST_PARTY | request-header | ${entries.length} static-asset Referer inventory rows summarized (${new Set(entries.map((entry) => entry.endpoint)).size} endpoints) | ${sources.join(", ")} | ${transforms.join(", ")} | OBSERVED | — | ${occurrences} | ${markdownCell(visibleTestList(tests, 0))} |`,
    );
  }
  for (const entry of presentation.entries) {
    const provenance = sourceProvenanceLabel(entry);
    const sources = `${entry.sourceKinds.join(", ")}${provenance === undefined ? "" : ` (${provenance})`}`;
    lines.push(
      `| ${markdownCell(entry.dataCategory)} | ${entry.boundary} | ${entry.sinkKind} | ${markdownCell(requestLabel(entry) || "—")} | ${markdownCell(sources)} | ${entry.transforms.join(", ")} | ${entry.state} | ${entry.changeReasons.join(", ") || "—"} | ${entry.occurrences} | ${markdownCell(visibleTests(entry) || "—")} |`,
    );
  }
  if (inventory.entries.length === 0) {
    lines.push("| — | — | — | No supported data flows observed | — | — | — | — | 0 | — |");
  }
  if (inventory.resolved.length > 0) {
    lines.push("", `## Resolved baseline candidates (${inventory.resolved.length})`, "");
    for (const flow of inventory.resolved) {
      lines.push(
        `- ${flow.ruleId} ${flow.dataCategory} → ${flow.sinkKind}${flow.recipient ? ` → ${markdownCell(flow.recipient)}` : ""}${flow.endpoint ? ` → ${markdownCell(flow.endpoint)}` : ""}${flow.location ? ` → ${markdownCell(flow.location)}` : ""}`,
      );
    }
  }
  lines.push("", "## Limitations", "");
  for (const limitation of inventory.limitations) lines.push(`- ${limitation}`);
  return `${lines.join("\n")}\n`;
};

const spreadsheetSafe = (value: string): string => (/^[=+\-@]/u.test(value) ? `'${value}` : value);

const csvCell = (value: string | number | boolean): string => {
  const safe = spreadsheetSafe(String(value));
  return /[",\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

export const renderInventoryCsv = (inventory: PrivacyInventory): string => {
  const headers = [
    "recordType",
    "sourceRun",
    "sourceStatus",
    "inventorySchemaVersion",
    "generatedAt",
    "inventoryEntries",
    "inventoryOccurrences",
    "inventoryCategories",
    "externalRecipients",
    "resolvedCandidates",
    "dataCategory",
    "boundary",
    "sinkKind",
    "recipient",
    "method",
    "endpoint",
    "location",
    "state",
    "changeReasons",
    "sourceKinds",
    "sourceOrigin",
    "sourceEndpoint",
    "sourceLocation",
    "sourceConfidences",
    "transforms",
    "severities",
    "occurrences",
    "tests",
    "testsTruncated",
  ];
  const sourceRun = inventory.sourceReport.complete ? "COMPLETE" : "INCOMPLETE";
  const sourceStatus = inventory.sourceReport.status.toUpperCase();
  const lines = [
    headers.map(csvCell).join(","),
    [
      "SUMMARY",
      sourceRun,
      sourceStatus,
      inventory.inventorySchemaVersion,
      inventory.sourceReport.generatedAt,
      inventory.summary.entries,
      inventory.summary.occurrences,
      inventory.summary.categories,
      inventory.summary.externalRecipients,
      inventory.resolved.length,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]
      .map(csvCell)
      .join(","),
  ];
  for (const entry of inventory.entries) {
    lines.push(
      [
        "ENTRY",
        sourceRun,
        sourceStatus,
        inventory.inventorySchemaVersion,
        inventory.sourceReport.generatedAt,
        inventory.summary.entries,
        inventory.summary.occurrences,
        inventory.summary.categories,
        inventory.summary.externalRecipients,
        inventory.resolved.length,
        entry.dataCategory,
        entry.boundary,
        entry.sinkKind,
        entry.recipient?.origin ?? "",
        entry.method ?? "",
        entry.endpoint ?? "",
        entry.location ?? "",
        entry.state,
        entry.changeReasons.join(";"),
        entry.sourceKinds.join(";"),
        entry.sourceProvenance?.origin ?? "",
        entry.sourceProvenance?.endpoint ?? "",
        entry.sourceProvenance?.location ?? "",
        entry.sourceConfidences.join(";"),
        entry.transforms.join(";"),
        entry.severities.join(";"),
        entry.occurrences,
        JSON.stringify(entry.tests),
        entry.testsTruncated,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
};

export const renderPrivacyInventory = (
  inventory: PrivacyInventory,
  format: InventoryFormat,
): string => {
  if (format === "json") return `${JSON.stringify(inventory, null, 2)}\n`;
  if (format === "csv") return renderInventoryCsv(inventory);
  if (format === "markdown") return renderInventoryMarkdown(inventory);
  return renderInventoryTerminal(inventory);
};
