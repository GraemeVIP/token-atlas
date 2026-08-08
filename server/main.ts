/**
 * The single-binary server. Serves the embedded UI and the one API route,
 * replacing Next.js at runtime — the dashboard is entirely client-side, so
 * nothing needs server rendering.
 *
 * Compiled with `deno compile`, this ships as one executable with no runtime
 * dependency on Node, npm or Deno itself.
 */
import { scan } from "../lib/scan.ts";
import { ASSETS } from "./assets.ts";

const args = new Set(Deno.args);
const argv = Deno.args;

if (args.has("--help") || args.has("-h")) {
  console.log(`
  token-atlas — see where your Claude Code and Codex tokens actually go

  Usage:  token-atlas [options]

  Options:
    --port <n>    port to listen on (default 4319, or the next free one)
    --no-open     don't open a browser
    --help        show this

  Reads local session logs only. Nothing leaves your machine.
  Override locations with TOKEN_ATLAS_CLAUDE_DIR / TOKEN_ATLAS_CODEX_DIR.
`);
  Deno.exit(0);
}

const wanted = Number(argv[argv.indexOf("--port") + 1]) || 4319;

// Decode once at startup; the UI is a couple of MB at most.
const decoded = new Map<string, { type: string; body: Uint8Array }>();
for (const [route, a] of Object.entries(ASSETS)) {
  const bin = Uint8Array.from(atob(a.b64), (c) => c.charCodeAt(0));
  decoded.set(route, { type: a.type, body: bin });
}

function asset(pathname: string) {
  return (
    decoded.get(pathname) ??
    decoded.get(pathname.replace(/\/$/, "") + "/index.html") ??
    (pathname === "/" ? decoded.get("/index.html") : undefined)
  );
}

function openBrowser(url: string) {
  const cmd =
    Deno.build.os === "darwin" ? ["open", url]
    : Deno.build.os === "windows" ? ["cmd", "/c", "start", "", url]
    : ["xdg-open", url];
  try {
    new Deno.Command(cmd[0], { args: cmd.slice(1), stdout: "null", stderr: "null" }).spawn();
  } catch {
    /* convenience only — the URL is printed regardless */
  }
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/api/usage") {
    try {
      const data = await scan(url.searchParams.get("force") === "1");
      return Response.json(data, { headers: { "cache-control": "no-store" } });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
  }

  const hit = asset(url.pathname);
  if (hit) {
    return new Response(hit.body, {
      headers: {
        "content-type": hit.type,
        // Hashed Next asset filenames are safe to cache hard; HTML is not.
        "cache-control": url.pathname.startsWith("/_next/")
          ? "public, max-age=31536000, immutable"
          : "no-store",
      },
    });
  }
  return new Response("Not found", { status: 404 });
}

// Bind to loopback only: this exposes your session-log stats, and there is no
// reason for anything off-machine to reach it.
let port = wanted;
let server;
for (let attempt = 0; attempt < 40; attempt++) {
  try {
    server = Deno.serve({ port, hostname: "127.0.0.1", onListen: () => {} }, handler);
    break;
  } catch (err) {
    if (err instanceof Deno.errors.AddrInUse) { port++; continue; }
    throw err;
  }
}
if (!server) {
  console.error(`  Could not find a free port near ${wanted}.`);
  Deno.exit(1);
}

const url = `http://localhost:${port}`;
console.log(`\n  Token Atlas — reading local Claude Code and Codex logs`);
console.log(`  Nothing is uploaded. The first scan can take ~30s on a big history.\n`);
console.log(`  ${url}\n`);
console.log(`  Press Ctrl+C to stop.\n`);

if (!args.has("--no-open")) openBrowser(url);

await server.finished;
