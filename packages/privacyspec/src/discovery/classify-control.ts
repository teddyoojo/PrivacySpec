import type {
  ControlClassification,
  ControlClassificationInput,
  DataCategory,
} from "./source-model.js";

export const classifySensitiveControl = (
  control: ControlClassificationInput,
): ControlClassification | undefined => {
  if (
    control.value.length < 6 ||
    control.value.length > 4_096 ||
    control.value.trim().length === 0
  ) {
    return undefined;
  }

  const type = control.type?.trim().toLowerCase() ?? "";
  const autocompleteTokens = (control.autocomplete ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean);

  const classify = (
    category: DataCategory,
    typeValue: string,
    autocomplete: (token: string) => boolean,
  ): ControlClassification | undefined => {
    const evidence: ControlClassification["evidence"] = [];
    if (type === typeValue) {
      evidence.push({ kind: "input-type", value: typeValue });
    }
    const autocompleteToken = autocompleteTokens.find(autocomplete);
    if (autocompleteToken !== undefined) {
      evidence.push({ kind: "autocomplete", value: autocompleteToken });
    }
    return evidence.length === 0 ? undefined : { category, confidence: "high", evidence };
  };

  return (
    classify(
      "secret.password",
      "password",
      (token) => token === "current-password" || token === "new-password",
    ) ??
    classify("personal.email", "email", (token) => token === "email") ??
    classify("personal.phone", "tel", (token) => token === "tel" || token.startsWith("tel-"))
  );
};
