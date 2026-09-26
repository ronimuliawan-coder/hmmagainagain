// Builds the repo-root web UI for the Tauri shell. A file (not an inline
// shell line) because PowerShell and bash quote differently, and neither
// `bun run` (no upward package.json walk) nor `bun --cwd` (absolute paths
// only) crosses from tauri/ to the root portably. Runs wherever node runs.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
execFileSync("bun", ["run", "build:web"], { cwd: root, stdio: "inherit" });
