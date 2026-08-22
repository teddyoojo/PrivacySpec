import type { BrowserContext, Request, Response } from "@playwright/test";
import { compareCanonicalStrings } from "../canonical-order.js";

export const MAX_SECURITY_RESPONSES_PER_TEST = 2_048;
export const MAX_SECURITY_HEADER_LENGTH = 8_192;

export interface RuntimeSecurityCookie {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "strict" | "lax" | "none" | "unspecified";
}

export interface RuntimeSecurityResponse {
  url: string;
  method: string;
  resourceType: string;
  frameKind: "main" | "child" | "unknown";
  status: number;
  headers: {
    contentSecurityPolicy?: string | undefined;
    strictTransportSecurity?: string | undefined;
    xContentTypeOptions?: string | undefined;
    accessControlAllowOrigin?: string | undefined;
    accessControlAllowCredentials?: string | undefined;
    accessControlAllowMethods?: string | undefined;
  };
  cookies: RuntimeSecurityCookie[];
}

export interface SecurityResponseCoverage {
  enabled: true;
  seen: number;
  emitted: number;
  limitReached: boolean;
  workFailed: boolean;
}

export interface SecurityResponseConsumer {
  reserveSecurityResponse(response: Response): number;
  addSecurityResponse(
    observation: RuntimeSecurityResponse,
    response: Response,
    reservedSequence: number,
  ): void;
}

const boundedHeader = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  return value.length <= MAX_SECURITY_HEADER_LENGTH ? value : ":oversized";
};

const requestFrameKind = (request: Request): RuntimeSecurityResponse["frameKind"] => {
  try {
    return request.frame().parentFrame() === null ? "main" : "child";
  } catch {
    return "unknown";
  }
};

const authCookiePattern = /(?:^|[._-])(auth|identity|jwt|login|session|sid|token)(?:$|[._-])/iu;
const cookieNamePattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/u;

export const isSecurityCookieName = (name: string): boolean =>
  cookieNamePattern.test(name) && authCookiePattern.test(name);

export const parseSecurityCookie = (header: string): RuntimeSecurityCookie | undefined => {
  const parts = header.split(";");
  const pair = parts.shift()?.trim() ?? "";
  const separator = pair.indexOf("=");
  const name = separator > 0 ? pair.slice(0, separator).trim() : "";
  if (!isSecurityCookieName(name)) return undefined;
  let sameSite: RuntimeSecurityCookie["sameSite"] = "unspecified";
  let secure = false;
  let httpOnly = false;
  for (const rawAttribute of parts) {
    const [rawName, rawValue] = rawAttribute.trim().split("=", 2);
    const attribute = rawName?.toLowerCase();
    if (attribute === "secure") secure = true;
    if (attribute === "httponly") httpOnly = true;
    if (attribute === "samesite") {
      const value = rawValue?.trim().toLowerCase();
      if (value === "strict" || value === "lax" || value === "none") sameSite = value;
    }
  }
  return { name: name.toLowerCase(), secure, httpOnly, sameSite };
};

const captureSecurityResponse = async (
  response: Response,
): Promise<RuntimeSecurityResponse | undefined> => {
  const request = response.request();
  const resourceType = request.resourceType();
  const headerArray = await response.headersArray();
  const selected = new Map<string, string>();
  const cookies: RuntimeSecurityCookie[] = [];
  for (const header of headerArray) {
    const name = header.name.toLowerCase();
    if (name === "set-cookie") {
      const cookie = parseSecurityCookie(header.value);
      if (cookie !== undefined) cookies.push(cookie);
    } else if (
      name === "content-security-policy" ||
      name === "strict-transport-security" ||
      name === "x-content-type-options" ||
      name === "access-control-allow-origin" ||
      name === "access-control-allow-credentials" ||
      name === "access-control-allow-methods"
    ) {
      if (!selected.has(name)) selected.set(name, header.value);
    }
  }
  if (
    resourceType !== "document" &&
    resourceType !== "fetch" &&
    resourceType !== "xhr" &&
    cookies.length === 0
  ) {
    return undefined;
  }
  cookies.sort((left, right) => compareCanonicalStrings(left.name, right.name));
  return {
    url: response.url(),
    method: request.method(),
    resourceType,
    frameKind: requestFrameKind(request),
    status: response.status(),
    headers: {
      contentSecurityPolicy: boundedHeader(selected.get("content-security-policy")),
      strictTransportSecurity: boundedHeader(selected.get("strict-transport-security")),
      xContentTypeOptions: boundedHeader(selected.get("x-content-type-options")),
      accessControlAllowOrigin: boundedHeader(selected.get("access-control-allow-origin")),
      accessControlAllowCredentials: boundedHeader(
        selected.get("access-control-allow-credentials"),
      ),
      accessControlAllowMethods: boundedHeader(selected.get("access-control-allow-methods")),
    },
    cookies,
  };
};

export class SecurityResponseObserver {
  readonly #pending = new Set<Promise<void>>();
  readonly #coverage: SecurityResponseCoverage = {
    enabled: true,
    seen: 0,
    emitted: 0,
    limitReached: false,
    workFailed: false,
  };
  #context: BrowserContext | undefined;
  #scheduled = 0;
  readonly #listener: (response: Response) => void;

  constructor(private readonly consumer: SecurityResponseConsumer) {
    this.#listener = (response) => this.#accept(response);
  }

  attach(context: BrowserContext): void {
    if (this.#context !== undefined) return;
    this.#context = context;
    context.on("response", this.#listener);
  }

  detach(): void {
    this.#context?.off("response", this.#listener);
    this.#context = undefined;
  }

  snapshot(): SecurityResponseCoverage {
    return { ...this.#coverage };
  }

  async flush(): Promise<void> {
    await Promise.allSettled(Array.from(this.#pending));
  }

  #accept(response: Response): void {
    this.#coverage.seen += 1;
    if (this.#scheduled >= MAX_SECURITY_RESPONSES_PER_TEST) {
      this.#coverage.limitReached = true;
      return;
    }
    this.#scheduled += 1;
    const reservedSequence = this.consumer.reserveSecurityResponse(response);
    let operation: Promise<void>;
    operation = captureSecurityResponse(response).then(
      (observation) => {
        if (observation !== undefined) {
          this.#coverage.emitted += 1;
          this.consumer.addSecurityResponse(observation, response, reservedSequence);
        }
        this.#pending.delete(operation);
      },
      () => {
        this.#coverage.workFailed = true;
        this.#pending.delete(operation);
      },
    );
    this.#pending.add(operation);
  }
}
