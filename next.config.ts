import type { NextConfig } from "next";

// Two build shapes from one codebase:
//  - standalone: the Node/npx package (keeps the /api/usage route)
//  - export:     a purely static UI, embedded into the Deno single binary,
//                which serves /api/usage itself
const nextConfig: NextConfig = {
  output: process.env.STATIC_EXPORT ? "export" : "standalone",
};

export default nextConfig;
