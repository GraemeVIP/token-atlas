/**
 * Cross-compiles the single binary for every platform from one machine.
 * Deno bundles its own runtime, so the result needs no Node, npm or Deno
 * installed on the user's machine.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TARGETS = [
  ["aarch64-apple-darwin", "token-atlas-macos-arm64"],
  ["x86_64-apple-darwin", "token-atlas-macos-intel"],
  ["x86_64-pc-windows-msvc", "token-atlas-windows.exe"],
  ["x86_64-unknown-linux-gnu", "token-atlas-linux-x64"],
  ["aarch64-unknown-linux-gnu", "token-atlas-linux-arm64"],
];

const root = process.cwd();
const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });

if (!fs.existsSync(path.join(root, "server", "assets.ts"))) {
  console.error("server/assets.ts missing — run `npm run build:binary` instead.");
  process.exit(1);
}

const only = process.argv[2];
for (const [target, name] of TARGETS) {
  if (only && !target.includes(only) && !name.includes(only)) continue;
  const out = path.join(dist, name);
  process.stdout.write(`compiling ${name.padEnd(28)} `);
  try {
    execSync(
      `deno compile --quiet --no-check ` +
        // Without this Deno bakes the entire 357 MB node_modules into every
        // binary (429 MB -> 70 MB). Nothing here imports from npm; the server
        // and scanner use only node: builtins, which Deno provides natively.
        `--node-modules-dir=none ` +
        // Least privilege: read logs, write only the cache, resolve $HOME,
        // and spawn exactly one thing (the browser opener).
        `--allow-read --allow-write --allow-env --allow-sys --allow-net=127.0.0.1 --allow-run ` +
        `--target ${target} --output "${out}" server/main.ts`,
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    const mb = (fs.statSync(out).size / 1e6).toFixed(1);
    console.log(`ok  ${mb} MB`);
  } catch (err) {
    console.log("FAILED");
    console.error(String(err.stderr ?? err).slice(0, 600));
  }
}

console.log(`\nbinaries in ${path.relative(root, dist)}/`);
