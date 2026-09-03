import { writeFile } from "node:fs/promises";

const ATTACHMENT_NAME = "privacyspec-result";
const ATTACHMENT_CONTENT_TYPE = "application/json";

const containsSensitiveMaterial = (serialized) => {
  const email = /(?:Create|Login)-[a-z0-9-]+@example\.test/iu;
  const encodedEmail = /(?:Create|Login)-[a-z0-9-]+%40example\.test/iu;
  const password = /temporary-[a-z0-9-]+-credential/iu;
  const phone = /(?:\+|%2b)49170\d{9}/iu;
  if (
    email.test(serialized) ||
    encodedEmail.test(serialized) ||
    password.test(serialized) ||
    phone.test(serialized) ||
    /\b[a-f0-9]{64}\b/iu.test(serialized)
  ) {
    return true;
  }

  for (const [candidate] of serialized.matchAll(/[a-z0-9+/]{16,}={0,2}/giu)) {
    const decoded = Buffer.from(candidate, "base64").toString("utf8");
    if (email.test(decoded) || password.test(decoded) || /\+49170\d{9}/u.test(decoded)) {
      return true;
    }
  }
  return false;
};

export default class CapturePrivacySpecReporter {
  #records = [];
  #errors = [];

  onTestEnd(test, result) {
    const attachments = result.attachments.filter(
      (attachment) => attachment.name === ATTACHMENT_NAME,
    );

    if (attachments.length !== 1) {
      this.#errors.push(
        `${test.title}: expected one ${ATTACHMENT_NAME} attachment, received ${attachments.length}`,
      );
      return;
    }

    const [attachment] = attachments;
    if (attachment.contentType !== ATTACHMENT_CONTENT_TYPE || attachment.body === undefined) {
      this.#errors.push(`${test.title}: ${ATTACHMENT_NAME} must be inline JSON`);
      return;
    }

    try {
      this.#records.push({
        title: test.title,
        status: result.status,
        result: JSON.parse(attachment.body.toString("utf8")),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown JSON parse error";
      this.#errors.push(`${test.title}: invalid ${ATTACHMENT_NAME} attachment (${message})`);
    }
  }

  async onEnd() {
    const outputPath = process.env.PRIVACYSPEC_CAPTURE_FILE;
    if (outputPath === undefined || outputPath.length === 0) {
      throw new Error("PRIVACYSPEC_CAPTURE_FILE is required by the test capture reporter");
    }

    if (this.#errors.length > 0) {
      throw new Error(this.#errors.join("\n"));
    }

    const serialized = `${JSON.stringify({ schemaVersion: 1, records: this.#records }, null, 2)}\n`;
    if (containsSensitiveMaterial(serialized)) {
      throw new Error("PrivacySpec capture contained sensitive or transformed test material");
    }
    await writeFile(outputPath, serialized, { encoding: "utf8", mode: 0o600 });
  }
}
