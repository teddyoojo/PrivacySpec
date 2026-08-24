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

  const type = control.type?.slice(0, 200).trim().toLowerCase() ?? "";
  const autocompleteTokens = (control.autocomplete ?? "")
    .slice(0, 200)
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
  const normalizedValue = control.value.trim();

  const normalizeHint = (value: string | undefined): string =>
    (value ?? "")
      .slice(0, 200)
      .normalize("NFKC")
      .replace(/([a-z\d])([A-Z])/gu, "$1 $2")
      .toLowerCase()
      .replace(/[^a-z\d]+/gu, " ")
      .trim()
      .replace(/\s+/gu, " ");

  const metadata = [
    { kind: "name-attribute" as const, value: normalizeHint(control.name), group: "machine" },
    { kind: "id-attribute" as const, value: normalizeHint(control.id), group: "machine" },
    { kind: "aria-label" as const, value: normalizeHint(control.ariaLabel), group: "accessible" },
    {
      kind: "label" as const,
      value: normalizeHint(control.associatedLabel),
      group: "accessible",
    },
    {
      kind: "placeholder" as const,
      value: normalizeHint(control.placeholder),
      group: "accessible",
    },
  ];

  const autocompleteEvidence = (tokens: readonly string[]): ControlClassification["evidence"] => {
    const token = tokens.find((candidate) => autocompleteTokens.includes(candidate));
    return token === undefined ? [] : [{ kind: "autocomplete", value: token }];
  };

  const corroboratedMetadataEvidence = (
    aliases: readonly string[],
  ): ControlClassification["evidence"] => {
    const matches = metadata.filter(
      (item) => item.value.length > 0 && aliases.includes(item.value),
    );
    if (
      !matches.some((item) => item.group === "machine") ||
      !matches.some((item) => item.group === "accessible")
    ) {
      return [];
    }
    return matches.map(({ kind, value }) => ({ kind, value }));
  };

  const result = (
    category: DataCategory,
    evidence: ControlClassification["evidence"],
  ): ControlClassification | undefined =>
    evidence.length === 0 ? undefined : { category, confidence: "high", evidence };

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

  // Password semantics retain precedence over every other attribute combination.
  if (normalizedValue.length >= 6) {
    const password = classify(
      "secret.password",
      "password",
      (token) => token === "current-password" || token === "new-password",
    );
    if (password !== undefined) return password;

    // Exact email/telephone autocomplete intent remains stronger than unrelated fallback hints.
    const contactAutocomplete =
      (autocompleteTokens.includes("email")
        ? classify("personal.email", "email", (token) => token === "email")
        : undefined) ??
      (autocompleteTokens.some((token) => token === "tel" || token.startsWith("tel-"))
        ? classify("personal.phone", "tel", (token) => token === "tel" || token.startsWith("tel-"))
        : undefined);
    if (contactAutocomplete !== undefined) return contactAutocomplete;
  }

  const paymentAutocompleteTokens = [
    "cc-number",
    "cc-csc",
    "cc-exp",
    "cc-exp-month",
    "cc-exp-year",
    "cc-name",
    "cc-given-name",
    "cc-additional-name",
    "cc-family-name",
  ] as const;
  const paymentToken = paymentAutocompleteTokens.find((token) =>
    autocompleteTokens.includes(token),
  );
  const paymentDigits = normalizedValue.replace(/[\s-]/gu, "");
  const validCardNumber = (): boolean => {
    if (!/^\d{12,19}$/u.test(paymentDigits) || /^(\d)\1+$/u.test(paymentDigits)) return false;
    let sum = 0;
    let doubleDigit = false;
    for (let index = paymentDigits.length - 1; index >= 0; index -= 1) {
      const digit = Number(paymentDigits[index]);
      let contribution = digit;
      if (doubleDigit) {
        contribution *= 2;
        if (contribution > 9) contribution -= 9;
      }
      sum += contribution;
      doubleDigit = !doubleDigit;
    }
    return sum % 10 === 0;
  };
  const validCardExpiry = (): boolean => {
    const yearMonth = /^(\d{4})-(\d{2})$/u.exec(normalizedValue);
    if (yearMonth !== null) {
      const month = Number(yearMonth[2]);
      return Number(yearMonth[1]) > 0 && month >= 1 && month <= 12;
    }
    const match = /^(\d{1,2})\s*[/-]\s*(\d{2}|\d{4})$/u.exec(normalizedValue);
    if (match === null) return false;
    const month = Number(match[1]);
    return month >= 1 && month <= 12 && Number(match[2]) > 0;
  };
  const validPaymentValue = (token: (typeof paymentAutocompleteTokens)[number]): boolean => {
    if (token === "cc-csc" || token === "cc-exp-month" || token === "cc-exp-year") return false;
    if (normalizedValue.length < 6) return false;
    if (token === "cc-number") return validCardNumber();
    if (token === "cc-exp") return validCardExpiry();
    return normalizedValue.length <= 200;
  };
  if (paymentToken !== undefined) {
    return validPaymentValue(paymentToken)
      ? result("personal.payment_card", autocompleteEvidence([paymentToken]))
      : undefined;
  }

  const paymentHints = [
    {
      aliases: ["card number", "credit card number", "payment card number", "cc number"],
      valid: validCardNumber,
    },
    {
      aliases: ["card expiration", "card expiry", "expiration date", "expiry date", "cc exp"],
      valid: validCardExpiry,
    },
    {
      aliases: ["cardholder name", "card holder name", "name on card", "cc name"],
      valid: () => normalizedValue.length >= 6 && normalizedValue.length <= 200,
    },
  ] as const;
  for (const hint of paymentHints) {
    if (!hint.valid()) continue;
    const classification = result(
      "personal.payment_card",
      corroboratedMetadataEvidence(hint.aliases),
    );
    if (classification !== undefined) return classification;
  }

  const validFullDate = (): boolean => {
    if (normalizedValue.length < 6) return false;
    const parts = /^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})$/u.exec(normalizedValue);
    if (parts === null) return false;
    const [first = "", second = "", third = ""] = parts.slice(1);
    const validCalendarDate = (year: number, month: number, day: number): boolean => {
      if (year < 1_000 || year > 9_999 || month < 1 || month > 12 || day < 1) return false;
      const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const daysByMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      return day <= (daysByMonth[month - 1] ?? 0);
    };
    if (first.length === 4) {
      return validCalendarDate(Number(first), Number(second), Number(third));
    }
    if (third.length !== 4) return false;
    return (
      validCalendarDate(Number(third), Number(second), Number(first)) ||
      validCalendarDate(Number(third), Number(first), Number(second))
    );
  };
  const birthDateAutocomplete = autocompleteEvidence(["bday"]);
  if (birthDateAutocomplete.length > 0) {
    return validFullDate() ? result("personal.date_of_birth", birthDateAutocomplete) : undefined;
  }
  const birthDateAliases = ["date of birth", "birth date", "birthday", "dob"];
  const birthDateMetadata = corroboratedMetadataEvidence(birthDateAliases);
  const birthDateLabel = metadata.some(
    (item) => item.group === "accessible" && birthDateAliases.includes(item.value),
  );
  if (validFullDate() && (birthDateMetadata.length > 0 || (type === "date" && birthDateLabel))) {
    return result("personal.date_of_birth", [
      ...(type === "date" ? [{ kind: "input-type" as const, value: "date" }] : []),
      ...birthDateMetadata,
      ...(birthDateMetadata.length === 0
        ? metadata
            .filter((item) => item.group === "accessible" && birthDateAliases.includes(item.value))
            .map(({ kind, value }) => ({ kind, value }))
        : []),
    ]);
  }

  const accountAutocomplete = autocompleteEvidence(["username"]);
  if (accountAutocomplete.length > 0) {
    return normalizedValue.length >= 6 && normalizedValue.length <= 320
      ? result("personal.account_identifier", accountAutocomplete)
      : undefined;
  }
  const accountAliases = [
    "account id",
    "account identifier",
    "customer id",
    "customer identifier",
    "member id",
    "user id",
    "user identifier",
    "username",
  ];
  if (normalizedValue.length >= 6 && normalizedValue.length <= 320) {
    const account = result(
      "personal.account_identifier",
      corroboratedMetadataEvidence(accountAliases),
    );
    if (account !== undefined) return account;
  }

  // These HTML autofill fields have explicit person-level semantics. Keep them
  // autocomplete-only rather than guessing from application-specific labels.
  const genderIdentityAutocomplete = autocompleteEvidence(["sex"]);
  if (genderIdentityAutocomplete.length > 0) {
    return normalizedValue.length <= 200
      ? result("personal.gender_identity", genderIdentityAutocomplete)
      : undefined;
  }
  const jobTitleAutocomplete = autocompleteEvidence(["organization-title"]);
  if (jobTitleAutocomplete.length > 0) {
    return normalizedValue.length <= 200
      ? result("personal.job_title", jobTitleAutocomplete)
      : undefined;
  }

  const nameAutocomplete = autocompleteEvidence([
    "name",
    "honorific-prefix",
    "given-name",
    "additional-name",
    "family-name",
    "honorific-suffix",
    "nickname",
  ]);
  if (nameAutocomplete.length > 0) {
    return normalizedValue.length >= 6 && normalizedValue.length <= 200
      ? result("personal.name", nameAutocomplete)
      : undefined;
  }
  const nameAliases = [
    "full name",
    "first name",
    "given name",
    "middle name",
    "additional name",
    "last name",
    "family name",
  ];
  if (normalizedValue.length >= 6 && normalizedValue.length <= 200) {
    const name = result("personal.name", corroboratedMetadataEvidence(nameAliases));
    if (name !== undefined) return name;
  }

  const addressAutocomplete = autocompleteEvidence([
    "street-address",
    "address-line1",
    "address-line2",
    "address-line3",
    "address-level1",
    "address-level2",
    "address-level3",
    "address-level4",
    "country",
    "country-name",
    "postal-code",
  ]);
  if (addressAutocomplete.length > 0) {
    return normalizedValue.length >= 6 && normalizedValue.length <= 512
      ? result("personal.postal_address", addressAutocomplete)
      : undefined;
  }
  const addressAliases = [
    "postal address",
    "mailing address",
    "street address",
    "address line 1",
    "address line 2",
    "address line 3",
    "address 1",
    "address 2",
    "address 3",
    "postal code",
    "zip code",
  ];
  if (normalizedValue.length >= 6 && normalizedValue.length <= 512) {
    const address = result("personal.postal_address", corroboratedMetadataEvidence(addressAliases));
    if (address !== undefined) return address;
  }

  // Input type remains a high-confidence fallback when no stronger semantic classifier matched.
  if (normalizedValue.length < 6) return undefined;
  return (
    classify("personal.email", "email", () => false) ??
    classify("personal.phone", "tel", () => false)
  );
};
