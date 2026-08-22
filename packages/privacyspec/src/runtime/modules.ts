export interface AnalysisModuleDescriptor<Id extends string = string> {
  id: Id;
  baselineNamespace: Id;
}

export const PRIVACY_ANALYSIS_MODULE = Object.freeze({
  id: "privacy",
  baselineNamespace: "privacy",
} satisfies AnalysisModuleDescriptor<"privacy">);

export const DEPENDENCY_ANALYSIS_MODULE = Object.freeze({
  id: "dependency",
  baselineNamespace: "dependency",
} satisfies AnalysisModuleDescriptor<"dependency">);

export const SECURITY_ANALYSIS_MODULE = Object.freeze({
  id: "security",
  baselineNamespace: "security",
} satisfies AnalysisModuleDescriptor<"security">);

export const RUNTIME_FAILURE_ANALYSIS_MODULE = Object.freeze({
  id: "runtime-error",
  baselineNamespace: "runtime-error",
} satisfies AnalysisModuleDescriptor<"runtime-error">);

export const namespacedAnalysisIdentity = (
  module: AnalysisModuleDescriptor,
  semanticIdentity: string,
): string => `${module.baselineNamespace}:${semanticIdentity}`;
