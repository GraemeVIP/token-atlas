/**
 * `next build --output standalone` deliberately omits static assets, because
 * they are normally served by a CDN. For an npx-distributed local app they
 * have to sit next to the server or every page loads unstyled.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

if (!fs.existsSync(standalone)) {
  console.error("prepack: .next/standalone missing — run `next build` first.");
  process.exit(1);
}

const copies = [
  [path.join(root, ".next", "static"), path.join(standalone, ".next", "static")],
  [path.join(root, "public"), path.join(standalone, "public")],
];

for (const [from, to] of copies) {
  if (!fs.existsSync(from)) continue;
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  console.log(`prepack: copied ${path.relative(root, from)} -> ${path.relative(root, to)}`);
}

const server = path.join(standalone, "server.js");
if (!fs.existsSync(server)) {
  console.error("prepack: standalone/server.js missing after build.");
  process.exit(1);
}
console.log("prepack: ok");
