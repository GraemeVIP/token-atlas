/**
 * Builds the UI as a static export for embedding in the single binary.
 *
 * `output: "export"` refuses to build when a dynamic route handler exists, so
 * app/api is moved aside for the duration. The finally block puts it back even
 * if the build fails — losing it would silently break the npx package.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const api = path.join(root, "app", "api");
const parked = path.join(root, ".api-parked");

if (fs.existsSync(parked)) {
  console.error("`.api-parked` already exists — a previous run died. Restore it by hand before continuing.");
  process.exit(1);
}

let moved = false;
try {
  if (fs.existsSync(api)) {
    fs.renameSync(api, parked);
    moved = true;
  }
  // Next generates route-type validators that still reference the parked API
  // route; stale ones fail the type check. They are regenerated each build.
  for (const d of ["dev/types", "types"]) {
    fs.rmSync(path.join(root, ".next", d), { recursive: true, force: true });
  }
  execSync("next build", {
    stdio: "inherit",
    env: { ...process.env, STATIC_EXPORT: "1" },
  });
} finally {
  if (moved && fs.existsSync(parked)) {
    fs.rmSync(api, { recursive: true, force: true });
    fs.renameSync(parked, api);
    console.log("restored app/api");
  }
}

const out = path.join(root, "out");
if (!fs.existsSync(path.join(out, "index.html"))) {
  console.error("static export produced no out/index.html");
  process.exit(1);
}
console.log("static export ok ->", out);
