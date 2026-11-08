import { spawnSync } from "child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

const root = process.cwd();
const parkRoot = join(root, ".export-park");
const apiDir = join(root, "app", "api");
const apiParked = join(parkRoot, "api");
const instrumentation = join(root, "instrumentation.ts");
const instrumentationParked = join(parkRoot, "instrumentation.ts");

function parkDir(from, to) {
  if (!existsSync(from)) return;
  mkdirSync(parkRoot, { recursive: true });
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  rmSync(from, { recursive: true, force: true });
}

function restoreDir(from, to) {
  if (!existsSync(from)) return;
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  rmSync(from, { recursive: true, force: true });
}

function parkFile(from, to) {
  if (!existsSync(from)) return;
  mkdirSync(parkRoot, { recursive: true });
  rmSync(to, { force: true });
  cpSync(from, to);
  rmSync(from, { force: true });
}

function restoreFile(from, to) {
  if (!existsSync(from)) return;
  rmSync(to, { force: true });
  cpSync(from, to);
  rmSync(from, { force: true });
}

parkDir(apiDir, apiParked);
parkFile(instrumentation, instrumentationParked);
rmSync(join(root, ".next"), { recursive: true, force: true });

let exitCode = 1;
try {
  const result = spawnSync("npx", ["next", "build"], {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, STATIC_EXPORT: "1" },
  });
  exitCode = result.status ?? 1;
} finally {
  restoreDir(apiParked, apiDir);
  restoreFile(instrumentationParked, instrumentation);
  rmSync(parkRoot, { recursive: true, force: true });
}

process.exit(exitCode);
