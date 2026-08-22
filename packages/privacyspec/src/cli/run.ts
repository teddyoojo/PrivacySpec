import { writeSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  readCompleteDependencyLatestRunFile,
  readDependencyBaselineFile,
  writeDependencyBaselineFile,
} from "../analyzers/dependency/artifact.js";
import {
  DEFAULT_DEPENDENCY_BASELINE_PATH,
  DEFAULT_DEPENDENCY_LATEST_RUN_PATH,
  type DependencySemanticCandidate,
} from "../analyzers/dependency/model.js";
import {
  readCompleteRuntimeFailureLatestRunFile,
  readRuntimeFailureBaselineFile,
  writeRuntimeFailureBaselineFile,
} from "../analyzers/runtime-failure/artifact.js";
import {
  DEFAULT_RUNTIME_FAILURE_BASELINE_PATH,
  DEFAULT_RUNTIME_FAILURE_LATEST_RUN_PATH,
  type RuntimeFailureBaselineEntry,
} from "../analyzers/runtime-failure/model.js";
import {
  readCompleteSecurityLatestRunFile,
  readSecurityBaselineFile,
  writeSecurityBaselineFile,
} from "../analyzers/security/artifact.js";
import {
  DEFAULT_SECURITY_BASELINE_PATH,
  DEFAULT_SECURITY_LATEST_RUN_PATH,
  type SecurityBaselineEntry,
} from "../analyzers/security/model.js";
import {
  type BaselineFlow,
  DEFAULT_BASELINE_PATH,
  DEFAULT_LATEST_RUN_PATH,
} from "../baseline/schema.js";
import {
  readBaselineFile,
  readCompleteLatestRunFile,
  writeBaselineFile,
} from "../baseline/write.js";
import { createPrivacySpecEvidence, validateEvidenceIdentifier } from "../evidence/create.js";
import type { EvidenceFormat } from "../evidence/model.js";
import { renderPrivacySpecEvidence } from "../evidence/render.js";
import { writeEvidenceOutput } from "../evidence/write.js";
import { createPrivacyInventory } from "../inventory/create.js";
import type { InventoryFormat } from "../inventory/model.js";
import { renderPrivacyInventory } from "../inventory/render.js";
import { writeInventoryOutput } from "../inventory/write.js";
import { DEFAULT_REPORT_PATH } from "../report/model.js";
import { readPrivacySpecReport } from "../report/read.js";
import { RULE_DEFINITIONS } from "../rules/definitions.js";
import { getRuleLegalMapping, type RuleLegalMapping } from "../rules/legal-map.js";
import type { RuleId } from "../rules/model.js";
import { createTestDataReport } from "../testdata/create.js";
import type { TestDataFormat } from "../testdata/model.js";
import { renderPrivacySpecTestData } from "../testdata/render.js";
import type { StorageStateScanFormat } from "../testdata/storage-state-model.js";
import { renderStorageStateScan } from "../testdata/storage-state-render.js";
import { scanStorageStateFiles } from "../testdata/storage-state-scan.js";
import { writeTestDataOutput } from "../testdata/write.js";

const USAGE = `Usage:
  privacyspec explain <rule-id>
  privacyspec baseline show [--module privacy|dependencies|security|runtime] [--baseline <path>]
  privacyspec baseline update [--module privacy|dependencies|security|runtime] [--baseline <path>] [--report <path>] [--yes]
  privacyspec inventory [--report <path>] [--format terminal|json|csv|markdown] [--output <path>]
  privacyspec testdata [--report <path>] [--format terminal|json|markdown] [--output <path>]
  privacyspec testdata scan <path...> [--format terminal|json|markdown] [--output <path>]
  privacyspec evidence [--report <path>] [--format json|markdown] [--output <path>] [--commit <id>] [--build-id <id>]
`;

type WriteMessage = (message: string) => void;

export interface CliRuntime {
  cwd?: string | undefined;
  env?: Readonly<Record<string, string | undefined>> | undefined;
  writeOut?: WriteMessage | undefined;
  writeError?: WriteMessage | undefined;
  interactive?: boolean | undefined;
  confirm?: ((question: string) => Promise<boolean>) | undefined;
}

type BaselineModule = "privacy" | "dependencies" | "security" | "runtime";

interface ShowCommand {
  action: "show";
  module: BaselineModule;
  baselinePath: string;
}

interface UpdateCommand {
  action: "update";
  module: BaselineModule;
  baselinePath: string;
  reportPath: string;
  yes: boolean;
}

type BaselineCommand = ShowCommand | UpdateCommand;

interface ExplainCommand {
  action: "explain";
  ruleId: RuleId;
}

interface InventoryCommand {
  action: "inventory";
  reportPath: string;
  format: InventoryFormat;
  outputPath?: string | undefined;
}

interface TestDataCommand {
  action: "testdata";
  reportPath: string;
  format: TestDataFormat;
  outputPath?: string | undefined;
}

interface TestDataScanCommand {
  action: "testdata-scan";
  paths: string[];
  format: StorageStateScanFormat;
  outputPath?: string | undefined;
}

interface EvidenceCommand {
  action: "evidence";
  reportPath: string;
  format: EvidenceFormat;
  outputPath?: string | undefined;
  commit?: string | undefined;
  buildId?: string | undefined;
}

type CliCommand =
  | BaselineCommand
  | EvidenceCommand
  | ExplainCommand
  | InventoryCommand
  | TestDataScanCommand
  | TestDataCommand;

class CliArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliArgumentError";
  }
}

const quoted = (value: string): string => JSON.stringify(value);

const safeErrorMessage = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : "Unknown error.";
  let safe = "";
  for (const character of raw.slice(0, 2_048)) {
    const codePoint = character.codePointAt(0);
    safe +=
      codePoint !== undefined &&
      (codePoint < 32 ||
        (codePoint >= 127 && codePoint <= 159) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029 ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069))
        ? "?"
        : character;
  }
  return safe || "Unknown error.";
};

const requireFlagValue = (
  args: readonly string[],
  index: number,
  flag: string,
  valueKind = "path",
): string => {
  const value = args[index + 1];
  if (value === undefined || value.length === 0 || value.startsWith("--")) {
    throw new CliArgumentError(`${flag} requires a ${valueKind} value.`);
  }
  return value;
};

const parseBaselineCommand = (args: readonly string[], cwd: string): BaselineCommand => {
  if (args[0] !== "baseline") {
    throw new CliArgumentError(`Expected the ${quoted("baseline")} command.`);
  }
  const action = args[1];
  if (action !== "show" && action !== "update") {
    throw new CliArgumentError(
      `Expected ${quoted("show")} or ${quoted("update")} after ${quoted("baseline")}.`,
    );
  }

  let baselinePath: string | undefined;
  let reportPath: string | undefined;
  let module: BaselineModule = "privacy";
  let sawModule = false;
  let yes = false;
  let sawYes = false;

  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--module") {
      if (sawModule) throw new CliArgumentError("--module may be specified only once.");
      const value = requireFlagValue(args, index, argument, "module");
      if (
        value !== "privacy" &&
        value !== "dependencies" &&
        value !== "security" &&
        value !== "runtime"
      ) {
        throw new CliArgumentError(`Unsupported baseline module ${quoted(value)}.`);
      }
      module = value;
      sawModule = true;
      index += 1;
      continue;
    }
    if (argument === "--baseline") {
      if (baselinePath !== undefined) {
        throw new CliArgumentError("--baseline may be specified only once.");
      }
      baselinePath = requireFlagValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--report" && action === "update") {
      if (reportPath !== undefined) {
        throw new CliArgumentError("--report may be specified only once.");
      }
      reportPath = requireFlagValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--yes" && action === "update") {
      if (sawYes) throw new CliArgumentError("--yes may be specified only once.");
      sawYes = true;
      yes = true;
      continue;
    }
    throw new CliArgumentError(`Unexpected argument ${quoted(argument ?? "")}.`);
  }

  const resolvedBaselinePath = resolve(
    cwd,
    baselinePath ??
      (module === "dependencies"
        ? DEFAULT_DEPENDENCY_BASELINE_PATH
        : module === "security"
          ? DEFAULT_SECURITY_BASELINE_PATH
          : module === "runtime"
            ? DEFAULT_RUNTIME_FAILURE_BASELINE_PATH
            : DEFAULT_BASELINE_PATH),
  );
  if (action === "show") {
    return { action, module, baselinePath: resolvedBaselinePath };
  }
  return {
    action,
    module,
    baselinePath: resolvedBaselinePath,
    reportPath: resolve(
      cwd,
      reportPath ??
        (module === "dependencies"
          ? DEFAULT_DEPENDENCY_LATEST_RUN_PATH
          : module === "security"
            ? DEFAULT_SECURITY_LATEST_RUN_PATH
            : module === "runtime"
              ? DEFAULT_RUNTIME_FAILURE_LATEST_RUN_PATH
              : DEFAULT_LATEST_RUN_PATH),
    ),
    yes,
  };
};

const inventoryFormats = new Set<InventoryFormat>(["terminal", "json", "csv", "markdown"]);

const parseInventoryCommand = (args: readonly string[], cwd: string): InventoryCommand => {
  let reportPath: string | undefined;
  let format: InventoryFormat = "terminal";
  let sawFormat = false;
  let outputPath: string | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--report") {
      if (reportPath !== undefined) {
        throw new CliArgumentError("--report may be specified only once.");
      }
      reportPath = requireFlagValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--format") {
      if (sawFormat) throw new CliArgumentError("--format may be specified only once.");
      const value = requireFlagValue(args, index, argument, "format");
      if (!inventoryFormats.has(value as InventoryFormat)) {
        throw new CliArgumentError(`Unsupported inventory format ${quoted(value)}.`);
      }
      format = value as InventoryFormat;
      sawFormat = true;
      index += 1;
      continue;
    }
    if (argument === "--output") {
      if (outputPath !== undefined) {
        throw new CliArgumentError("--output may be specified only once.");
      }
      outputPath = requireFlagValue(args, index, argument);
      index += 1;
      continue;
    }
    throw new CliArgumentError(`Unexpected argument ${quoted(argument ?? "")} for inventory.`);
  }

  const resolvedReportPath = resolve(cwd, reportPath ?? DEFAULT_REPORT_PATH);
  const resolvedOutputPath = outputPath === undefined ? undefined : resolve(cwd, outputPath);
  if (resolvedOutputPath === resolvedReportPath) {
    throw new CliArgumentError("Inventory output must not overwrite its source JSON report.");
  }
  return {
    action: "inventory",
    reportPath: resolvedReportPath,
    format,
    outputPath: resolvedOutputPath,
  };
};

const testDataFormats = new Set<TestDataFormat>(["terminal", "json", "markdown"]);

const parseTestDataScanCommand = (args: readonly string[], cwd: string): TestDataScanCommand => {
  let format: StorageStateScanFormat = "terminal";
  let sawFormat = false;
  let outputPath: string | undefined;
  const paths: string[] = [];
  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--format") {
      if (sawFormat) throw new CliArgumentError("--format may be specified only once.");
      const value = requireFlagValue(args, index, argument, "format");
      if (!testDataFormats.has(value as TestDataFormat)) {
        throw new CliArgumentError(`Unsupported testdata scan format ${quoted(value)}.`);
      }
      format = value as StorageStateScanFormat;
      sawFormat = true;
      index += 1;
      continue;
    }
    if (argument === "--output") {
      if (outputPath !== undefined)
        throw new CliArgumentError("--output may be specified only once.");
      outputPath = requireFlagValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === undefined || argument.length === 0 || argument.startsWith("--")) {
      throw new CliArgumentError("Unexpected argument for testdata scan.");
    }
    paths.push(resolve(cwd, argument));
  }
  if (paths.length === 0) {
    throw new CliArgumentError("testdata scan requires at least one explicit storage-state path.");
  }
  if (new Set(paths).size !== paths.length) {
    throw new CliArgumentError("Each testdata scan path may be specified only once.");
  }
  const resolvedOutputPath = outputPath === undefined ? undefined : resolve(cwd, outputPath);
  if (resolvedOutputPath !== undefined && paths.includes(resolvedOutputPath)) {
    throw new CliArgumentError("Test-data scan output must not overwrite a storage-state input.");
  }
  return {
    action: "testdata-scan",
    paths,
    format,
    outputPath: resolvedOutputPath,
  };
};

const parseTestDataCommand = (args: readonly string[], cwd: string): TestDataCommand => {
  let reportPath: string | undefined;
  let format: TestDataFormat = "terminal";
  let sawFormat = false;
  let outputPath: string | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--report") {
      if (reportPath !== undefined)
        throw new CliArgumentError("--report may be specified only once.");
      reportPath = requireFlagValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--format") {
      if (sawFormat) throw new CliArgumentError("--format may be specified only once.");
      const value = requireFlagValue(args, index, argument, "format");
      if (!testDataFormats.has(value as TestDataFormat)) {
        throw new CliArgumentError(`Unsupported testdata format ${quoted(value)}.`);
      }
      format = value as TestDataFormat;
      sawFormat = true;
      index += 1;
      continue;
    }
    if (argument === "--output") {
      if (outputPath !== undefined)
        throw new CliArgumentError("--output may be specified only once.");
      outputPath = requireFlagValue(args, index, argument);
      index += 1;
      continue;
    }
    throw new CliArgumentError(`Unexpected argument ${quoted(argument ?? "")} for testdata.`);
  }
  const resolvedReportPath = resolve(cwd, reportPath ?? DEFAULT_REPORT_PATH);
  const resolvedOutputPath = outputPath === undefined ? undefined : resolve(cwd, outputPath);
  if (resolvedOutputPath === resolvedReportPath) {
    throw new CliArgumentError("Test-data output must not overwrite its source JSON report.");
  }
  return {
    action: "testdata",
    reportPath: resolvedReportPath,
    format,
    outputPath: resolvedOutputPath,
  };
};

const evidenceFormats = new Set<EvidenceFormat>(["json", "markdown"]);

const parseEvidenceCommand = (args: readonly string[], cwd: string): EvidenceCommand => {
  let reportPath: string | undefined;
  let format: EvidenceFormat = "markdown";
  let sawFormat = false;
  let outputPath: string | undefined;
  let commit: string | undefined;
  let buildId: string | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--report") {
      if (reportPath !== undefined)
        throw new CliArgumentError("--report may be specified only once.");
      reportPath = requireFlagValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--format") {
      if (sawFormat) throw new CliArgumentError("--format may be specified only once.");
      const value = requireFlagValue(args, index, argument, "format");
      if (!evidenceFormats.has(value as EvidenceFormat)) {
        throw new CliArgumentError(`Unsupported evidence format ${quoted(value)}.`);
      }
      format = value as EvidenceFormat;
      sawFormat = true;
      index += 1;
      continue;
    }
    if (argument === "--output") {
      if (outputPath !== undefined)
        throw new CliArgumentError("--output may be specified only once.");
      outputPath = requireFlagValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--commit") {
      if (commit !== undefined) throw new CliArgumentError("--commit may be specified only once.");
      commit = validateEvidenceIdentifier(
        requireFlagValue(args, index, argument, "build identifier"),
        "commit",
      );
      index += 1;
      continue;
    }
    if (argument === "--build-id") {
      if (buildId !== undefined)
        throw new CliArgumentError("--build-id may be specified only once.");
      buildId = validateEvidenceIdentifier(
        requireFlagValue(args, index, argument, "build identifier"),
        "build ID",
      );
      index += 1;
      continue;
    }
    throw new CliArgumentError(`Unexpected argument ${quoted(argument ?? "")} for evidence.`);
  }
  const resolvedReportPath = resolve(cwd, reportPath ?? DEFAULT_REPORT_PATH);
  const resolvedOutputPath = outputPath === undefined ? undefined : resolve(cwd, outputPath);
  if (resolvedOutputPath === resolvedReportPath) {
    throw new CliArgumentError("Evidence output must not overwrite its source JSON report.");
  }
  return {
    action: "evidence",
    reportPath: resolvedReportPath,
    format,
    outputPath: resolvedOutputPath,
    commit,
    buildId,
  };
};

const parseCliCommand = (args: readonly string[], cwd: string): CliCommand => {
  if (args[0] === "inventory") return parseInventoryCommand(args, cwd);
  if (args[0] === "testdata" && args[1] === "scan") return parseTestDataScanCommand(args, cwd);
  if (args[0] === "testdata") return parseTestDataCommand(args, cwd);
  if (args[0] === "evidence") return parseEvidenceCommand(args, cwd);
  if (args[0] !== "explain") return parseBaselineCommand(args, cwd);
  if (args.length !== 2) {
    throw new CliArgumentError(
      args[1] === undefined
        ? "The explain command requires exactly one rule ID."
        : "The explain command accepts exactly one rule ID.",
    );
  }
  const mapping = getRuleLegalMapping(args[1] ?? "");
  if (mapping === undefined) {
    throw new CliArgumentError(`Unknown PrivacySpec rule ${quoted(args[1] ?? "")}.`);
  }
  return { action: "explain", ruleId: mapping.ruleId };
};

const isTruthyCi = (value: string | undefined): boolean => {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && !["0", "false", "no", "off"].includes(normalized);
};

const flowSummary = (flow: BaselineFlow): string => {
  const details = [
    `${flow.ruleId} ${flow.dataCategory} -> ${flow.sinkKind}`,
    flow.recipient === undefined ? undefined : `recipient=${flow.recipient}`,
    flow.endpoint === undefined ? undefined : `endpoint=${flow.endpoint}`,
    flow.location === undefined ? undefined : `location=${flow.location}`,
    `transform=${flow.transform}`,
  ];
  return details.filter((detail) => detail !== undefined).join(" :: ");
};

const dependencySummary = (dependency: DependencySemanticCandidate): string =>
  `${dependency.category} -> ${dependency.host} :: ${dependency.key}`;

const securitySummary = (entry: SecurityBaselineEntry): string =>
  `${entry.responseKind} ${entry.method} ${entry.host}${entry.endpoint} :: ${entry.fingerprints.length} fingerprint variant${entry.fingerprints.length === 1 ? "" : "s"}`;

const runtimeFailureSummary = (entry: RuntimeFailureBaselineEntry): string => {
  const target = [entry.method, entry.host, entry.endpoint, entry.httpStatus, entry.failureCode]
    .filter((value) => value !== null)
    .join(" ");
  return `${entry.severity} ${entry.failureType} :: ${entry.summary}${target.length > 0 ? ` :: ${target}` : ""}`;
};

const promptForConfirmation = async (question: string): Promise<boolean> => {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await prompt.question(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    prompt.close();
  }
};

const formatRuleExplanation = (mapping: RuleLegalMapping): string => {
  const definition = RULE_DEFINITIONS[mapping.ruleId];
  const lines = [
    `PrivacySpec ${mapping.ruleId}: ${definition.title}`,
    "",
    "Observation rule:",
    mapping.observationRule,
    `Default outcome: ${definition.defaultClassification.toUpperCase()} / ${definition.defaultSeverity.toUpperCase()}`,
    "",
    "Technical controls:",
  ];
  for (const control of mapping.technicalControls) {
    lines.push(
      `- ${control.framework} ${control.version} ${control.control} (${control.requirementId}) [${control.relationship.toUpperCase()}]`,
      `  Relevance: ${control.rationale}`,
      `  Applicability: ${control.applicabilityCaveat}`,
      `  Source: ${control.sourceUrl}`,
      `  Last reviewed: ${control.lastReviewed}`,
    );
  }
  lines.push("", "EU regulatory relevance:");
  for (const relevance of mapping.regulatoryRelevance) {
    lines.push(
      `- ${relevance.instrument} ${relevance.provision} [${relevance.relationship.toUpperCase()}]`,
      `  Relevance: ${relevance.rationale}`,
      `  Applicability: ${relevance.applicabilityCaveat}`,
      `  Primary source: ${relevance.sourceUrl}`,
      `  Last reviewed: ${relevance.lastReviewed}`,
    );
  }
  lines.push("", "Limitations:");
  for (const limitation of mapping.limitations) lines.push(`- ${limitation}`);
  return `${lines.join("\n")}\n`;
};

export const runCli = async (
  args: readonly string[],
  runtime: CliRuntime = {},
): Promise<number> => {
  const writeOut = runtime.writeOut ?? ((message: string) => writeSync(process.stdout.fd, message));
  const writeError =
    runtime.writeError ?? ((message: string) => writeSync(process.stderr.fd, message));

  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    writeOut(USAGE);
    return 0;
  }

  let command: CliCommand;
  try {
    command = parseCliCommand(args, runtime.cwd ?? process.cwd());
  } catch (error) {
    writeError(`PrivacySpec CLI error: ${safeErrorMessage(error)}\n${USAGE}`);
    return 1;
  }

  try {
    if (command.action === "explain") {
      const mapping = getRuleLegalMapping(command.ruleId);
      if (mapping === undefined) {
        throw new Error(`No mapping is registered for ${command.ruleId}.`);
      }
      writeOut(formatRuleExplanation(mapping));
      return 0;
    }

    if (command.action === "inventory") {
      const report = await readPrivacySpecReport(command.reportPath);
      const inventory = createPrivacyInventory(report);
      const output = renderPrivacyInventory(inventory, command.format);
      if (command.outputPath === undefined) {
        writeOut(output);
      } else {
        await writeInventoryOutput(command.outputPath, output);
        writeOut(`PrivacySpec inventory written to ${quoted(command.outputPath)}.\n`);
      }
      return 0;
    }

    if (command.action === "testdata") {
      const report = await readPrivacySpecReport(command.reportPath);
      const testData = createTestDataReport(report);
      const output = renderPrivacySpecTestData(testData, command.format);
      if (command.outputPath === undefined) {
        writeOut(output);
      } else {
        await writeTestDataOutput(command.outputPath, output);
        writeOut(`PrivacySpec test-data hygiene written to ${quoted(command.outputPath)}.\n`);
      }
      return 0;
    }

    if (command.action === "testdata-scan") {
      const scan = await scanStorageStateFiles(command.paths);
      const output = renderStorageStateScan(scan, command.format);
      if (command.outputPath === undefined) {
        writeOut(output);
      } else {
        await writeTestDataOutput(command.outputPath, output);
        writeOut(`PrivacySpec storage-state hygiene written to ${quoted(command.outputPath)}.\n`);
      }
      return 0;
    }

    if (command.action === "evidence") {
      const report = await readPrivacySpecReport(command.reportPath);
      const evidence = createPrivacySpecEvidence(report, {
        commit: command.commit,
        buildId: command.buildId,
      });
      const output = renderPrivacySpecEvidence(evidence, command.format);
      if (command.outputPath === undefined) {
        writeOut(output);
      } else {
        await writeEvidenceOutput(command.outputPath, output);
        writeOut(`PrivacySpec evidence written to ${quoted(command.outputPath)}.\n`);
      }
      return 0;
    }

    if (command.action === "show") {
      if (command.module === "runtime") {
        const baseline = await readRuntimeFailureBaselineFile(command.baselinePath);
        if (baseline === undefined) {
          writeOut(
            `No PrivacySpec runtime failure baseline found at ${quoted(command.baselinePath)}.\n`,
          );
          return 0;
        }
        writeOut(
          `PrivacySpec runtime failure baseline: ${baseline.entries.length} accepted failure identit${baseline.entries.length === 1 ? "y" : "ies"}\n`,
        );
        writeOut(`Path: ${quoted(command.baselinePath)}\n`);
        for (const entry of baseline.entries) writeOut(`- ${runtimeFailureSummary(entry)}\n`);
        return 0;
      }
      if (command.module === "security") {
        const baseline = await readSecurityBaselineFile(command.baselinePath);
        if (baseline === undefined) {
          writeOut(
            `No PrivacySpec security posture baseline found at ${quoted(command.baselinePath)}.\n`,
          );
          return 0;
        }
        writeOut(
          `PrivacySpec security posture baseline: ${baseline.entries.length} accepted target${baseline.entries.length === 1 ? "" : "s"}\n`,
        );
        writeOut(`Path: ${quoted(command.baselinePath)}\n`);
        for (const entry of baseline.entries) writeOut(`- ${securitySummary(entry)}\n`);
        return 0;
      }
      if (command.module === "dependencies") {
        const baseline = await readDependencyBaselineFile(command.baselinePath);
        if (baseline === undefined) {
          writeOut(
            `No PrivacySpec dependency baseline found at ${quoted(command.baselinePath)}.\n`,
          );
          return 0;
        }
        writeOut(
          `PrivacySpec dependency baseline: ${baseline.dependencies.length} accepted semantic dependenc${baseline.dependencies.length === 1 ? "y" : "ies"}\n`,
        );
        writeOut(`Path: ${quoted(command.baselinePath)}\n`);
        for (const dependency of baseline.dependencies) {
          writeOut(`- ${dependencySummary(dependency)}\n`);
        }
        return 0;
      }
      const baseline = await readBaselineFile(command.baselinePath);
      if (baseline === undefined) {
        writeOut(`No PrivacySpec baseline found at ${quoted(command.baselinePath)}.\n`);
        return 0;
      }
      writeOut(
        `PrivacySpec baseline: ${baseline.flows.length} accepted review flow${baseline.flows.length === 1 ? "" : "s"}\n`,
      );
      writeOut(`Path: ${quoted(command.baselinePath)}\n`);
      for (const flow of baseline.flows) writeOut(`- ${flowSummary(flow)}\n`);
      return 0;
    }

    const environment = runtime.env ?? process.env;
    if (isTruthyCi(environment.CI)) {
      writeError("PrivacySpec baseline updates are disabled when CI is enabled.\n");
      return 1;
    }

    const dependencyLatestRun =
      command.module === "dependencies"
        ? await readCompleteDependencyLatestRunFile(command.reportPath)
        : undefined;
    const privacyLatestRun =
      command.module === "privacy"
        ? await readCompleteLatestRunFile(command.reportPath)
        : undefined;
    const securityLatestRun =
      command.module === "security"
        ? await readCompleteSecurityLatestRunFile(command.reportPath)
        : undefined;
    const runtimeFailureLatestRun =
      command.module === "runtime"
        ? await readCompleteRuntimeFailureLatestRunFile(command.reportPath)
        : undefined;
    const acceptedCount =
      dependencyLatestRun?.dependencies.length ??
      securityLatestRun?.entries.length ??
      runtimeFailureLatestRun?.entries.length ??
      privacyLatestRun?.flows.length ??
      0;
    const interactive =
      runtime.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
    if (!command.yes) {
      if (!interactive) {
        writeError("PrivacySpec baseline update requires --yes in a non-interactive shell.\n");
        return 1;
      }
      const confirm = runtime.confirm ?? promptForConfirmation;
      const acceptedDescription =
        command.module === "dependencies"
          ? `semantic dependenc${acceptedCount === 1 ? "y" : "ies"}`
          : command.module === "security"
            ? `security posture target${acceptedCount === 1 ? "" : "s"}`
            : command.module === "runtime"
              ? `runtime failure identit${acceptedCount === 1 ? "y" : "ies"}`
              : `review flow${acceptedCount === 1 ? "" : "s"}`;
      const accepted = await confirm(
        `Replace ${quoted(command.baselinePath)} with ${acceptedCount} accepted ${acceptedDescription}? Confirm the latest run covered the full intended test scope. [y/N] `,
      );
      if (!accepted) {
        writeOut("PrivacySpec baseline update cancelled.\n");
        return 0;
      }
    }

    if (command.module === "dependencies") {
      if (dependencyLatestRun === undefined) {
        throw new Error("Dependency latest-run artifact has the wrong module.");
      }
      const baseline = await writeDependencyBaselineFile(
        command.baselinePath,
        dependencyLatestRun.dependencies,
      );
      writeOut(
        `PrivacySpec dependency baseline updated at ${quoted(command.baselinePath)} with ${baseline.dependencies.length} accepted semantic dependenc${baseline.dependencies.length === 1 ? "y" : "ies"}.\n`,
      );
      writeOut(
        "Unobserved accepted dependencies were removed; update only from the full intended test scope.\n",
      );
      return 0;
    }
    if (command.module === "security") {
      if (securityLatestRun === undefined) {
        throw new Error("Security posture latest-run artifact has the wrong module.");
      }
      const baseline = await writeSecurityBaselineFile(
        command.baselinePath,
        securityLatestRun.entries,
      );
      writeOut(
        `PrivacySpec security posture baseline updated at ${quoted(command.baselinePath)} with ${baseline.entries.length} accepted target${baseline.entries.length === 1 ? "" : "s"}.\n`,
      );
      writeOut(
        "Unobserved accepted security targets were removed; update only from the full intended test scope.\n",
      );
      return 0;
    }
    if (command.module === "runtime") {
      if (runtimeFailureLatestRun === undefined) {
        throw new Error("Runtime failure latest-run artifact has the wrong module.");
      }
      const baseline = await writeRuntimeFailureBaselineFile(
        command.baselinePath,
        runtimeFailureLatestRun.entries,
      );
      writeOut(
        `PrivacySpec runtime failure baseline updated at ${quoted(command.baselinePath)} with ${baseline.entries.length} accepted failure identit${baseline.entries.length === 1 ? "y" : "ies"}.\n`,
      );
      writeOut(
        "Unobserved accepted runtime failures were removed; update only from the full intended test scope.\n",
      );
      return 0;
    }
    if (privacyLatestRun === undefined) {
      throw new Error("Privacy latest-run artifact has the wrong module.");
    }
    const baseline = await writeBaselineFile(command.baselinePath, privacyLatestRun.flows);
    writeOut(
      `PrivacySpec baseline updated at ${quoted(command.baselinePath)} with ${baseline.flows.length} accepted review flow${baseline.flows.length === 1 ? "" : "s"}.\n`,
    );
    writeOut(
      "Unobserved accepted flows were removed; update only from the full intended test scope.\n",
    );
    return 0;
  } catch (error) {
    writeError(`PrivacySpec CLI error: ${safeErrorMessage(error)}\n`);
    return 1;
  }
};
