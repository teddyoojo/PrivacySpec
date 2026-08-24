import { chmod } from "node:fs/promises";

await chmod(new URL("../bin/privacyspec.js", import.meta.url), 0o755);
