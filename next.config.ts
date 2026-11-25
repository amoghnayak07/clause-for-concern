import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components implies the Node.js runtime; route handlers must not
  // export a `runtime` segment config.
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
