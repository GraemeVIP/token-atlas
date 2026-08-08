#!/usr/bin/env node
/**
 * `npx token-atlas` — starts the local server and opens a browser.
 * Everything runs on this machine; nothing is uploaded anywhere.
 */
// npm only WARNS about `engines`, so an old-Node user would otherwise hit a
// cryptic syntax error deep inside the server. Fail early, in plain English.
const MAJOR = Number(process.versions.node.split(".")[0]);
if (MAJOR < 20) {
  console.error(
    `\n  Token Atlas needs Node 20 or newer. You have ${process.version}.\n\n` +
      `  Install the latest from https://nodejs.org (pick the big green LTS\n` +
      `  button), then run this again.\n`,
  );
  process.exit(1);
}

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

if (has("--help") || has("-h")) {
  console.log(`
  token-atlas — see where your Claude Code and Codex tokens actually go

  Usage:  npx token-atlas [options]

  Options:
    --port <n>    port to listen on (default 4319, or the next free one)
    --no-open     don't open a browser
    --help        show this

  Reads local session logs only. Nothing leaves your machine.
  Override log locations with TOKEN_ATLAS_CLAUDE_DIR / TOKEN_ATLAS_CODEX_DIR.
`);
  process.exit(0);
}

const wanted = Number(argv[argv.indexOf("--port") + 1]) || 4319;

const free = (port) =>
  new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });

async function pickPort(start) {
  for (let p = start; p < start + 40; p++) if (await free(p)) return p;
  return start;
}

/** Cross-platform "open this URL in the default browser". */
function openBrowser(url) {
  const cmd =
    process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : ["xdg-open", [url]];
  try {
    spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true }).unref();
  } catch {
    /* opening is a convenience; the URL is printed regardless */
  }
}

const standalone = path.join(ROOT, ".next", "standalone", "server.js");
if (!fs.existsSync(standalone)) {
  console.error(
    "\n  This build is missing its compiled server (.next/standalone).\n" +
      "  If you cloned the repo, run:  npm install && npm run build\n",
  );
  process.exit(1);
}

const port = await pickPort(wanted);
const url = `http://localhost:${port}`;

console.log(`\n  Token Atlas — reading local Claude Code and Codex logs`);
console.log(`  Nothing is uploaded. First scan can take ~30s on a big history.\n`);
console.log(`  ${url}\n`);

const child = spawn(process.execPath, [standalone], {
  cwd: path.join(ROOT, ".next", "standalone"),
  env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1" },
  stdio: ["ignore", "pipe", "inherit"],
});

let opened = false;
child.stdout.on("data", (b) => {
  const s = b.toString();
  if (!opened && /Ready|started server|Local:/i.test(s)) {
    opened = true;
    if (!has("--no-open")) openBrowser(url);
  }
  if (process.env.TOKEN_ATLAS_DEBUG) process.stdout.write(s);
});

const bye = () => {
  child.kill();
  process.exit(0);
};
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
child.on("exit", (code) => process.exit(code ?? 0));
