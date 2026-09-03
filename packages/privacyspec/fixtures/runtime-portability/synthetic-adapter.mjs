export class SyntheticRuntimeAdapter {
  #active = true;
  #sequence = 0;

  constructor(host, { testId, projectName, capabilities, clock = () => 0 }) {
    this.host = host;
    this.testId = testId;
    this.projectName = projectName;
    this.capabilities = capabilities;
    this.clock = clock;
  }

  emit(input) {
    if (!this.#active) throw new Error("synthetic runtime adapter is closed");
    const { contextId, pageId, timestamp, ...event } = structuredClone(input);
    this.#sequence += 1;
    const meta = Object.freeze({
      testId: this.testId,
      projectName: this.projectName,
      ...(contextId === undefined ? {} : { contextId }),
      ...(pageId === undefined ? {} : { pageId }),
      seq: this.#sequence,
      timestamp: timestamp ?? this.clock(),
    });
    this.host.emit({ ...event, meta });
    return meta;
  }

  async finalize({ file, title }) {
    if (!this.#active) throw new Error("synthetic runtime adapter is closed");
    this.#active = false;
    return this.host.finalizeTest({
      test: {
        testId: this.testId,
        file,
        title,
        projectName: this.projectName,
      },
      capabilities: this.capabilities,
    });
  }

  dispose() {
    this.#active = false;
    this.host.dispose();
  }
}
