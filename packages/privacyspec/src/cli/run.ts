import { writeSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
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
import { RULE_DEFINITIONS } from "../rules/definitions.js";
import { getRuleLegalMapping, type RuleLegalMapping } from "../rules/legal-map.js";
import type { RuleId } from "../rules/model.js";

const USAGE = `Usage:
  privacyspec explain <rule-id>
  privacyspec baseline show [--baseline <path>]
  privacyspec baseline update [--baseline <path>] [--report <path>] [--yes]
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

interface ShowCommand {
  action: "show";
  baselinePath: string;
}

interface UpdateCommand {
  action: "update";
  baselinePath: string;
  reportPath: string;
  yes: boolean;
}

type BaselineCommand = ShowCommand | UpdateCommand;

interface ExplainCommand {
  action: "explain";
  ruleId: RuleId;
}

type CliCommand = BaselineCommand | ExplainCommand;

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

const requireFlagValue = (args: readonly string[], index: number, flag: string): string => {
  const value = args[index + 1];
  if (value === undefined || value.length === 0 || value.startsWith("--")) {
    throw new CliArgumentError(`${flag} requires a path value.`);
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
  let yes = false;
  let sawYes = false;

  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index];
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

  const resolvedBaselinePath = resolve(cwd, baselinePath ?? DEFAULT_BASELINE_PATH);
  if (action === "show") {
    return { action, baselinePath: resolvedBaselinePath };
  }
  return {
    action,
    baselinePath: resolvedBaselinePath,
    reportPath: resolve(cwd, reportPath ?? DEFAULT_LATEST_RUN_PATH),
    yes,
  };
};

const parseCliCommand = (args: readonly string[], cwd: string): CliCommand => {
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

    if (command.action === "show") {
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

    const latestRun = await readCompleteLatestRunFile(command.reportPath);
    const interactive =
      runtime.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
    if (!command.yes) {
      if (!interactive) {
        writeError("PrivacySpec baseline update requires --yes in a non-interactive shell.\n");
        return 1;
      }
      const confirm = runtime.confirm ?? promptForConfirmation;
      const accepted = await confirm(
        `Replace ${quoted(command.baselinePath)} with ${latestRun.flows.length} accepted review flow${latestRun.flows.length === 1 ? "" : "s"}? Confirm the latest run covered the full intended test scope. [y/N] `,
      );
      if (!accepted) {
        writeOut("PrivacySpec baseline update cancelled.\n");
        return 0;
      }
    }

    const baseline = await writeBaselineFile(command.baselinePath, latestRun.flows);
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
