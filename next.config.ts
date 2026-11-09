import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Keep build output to the code that actually ships. The SQLite file is
  // created at runtime (see `src/lib/db/client.ts`), and the docs and test
  // suites are never read by the server, so tracing them only inflates the
  // deployment. Paths are globs resolved from the project root; `/*` applies
  // the exclusion to every server route.
  outputFileTracingExcludes: {
    "/*": ["./data/**", "./docs/**", "./tests/**"],
  },
  images: {
    // Thumbnail hosts returned by the YouTube Data API (plus the i.ytimg.com
    // fallback in `shared/youtube.ts`). Pinned to https and these exact hosts;
    // paths vary by thumbnail size, so the whole host is allowed.
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com", pathname: "/**" },
      { protocol: "https", hostname: "img.youtube.com", pathname: "/**" },
      { protocol: "https", hostname: "yt3.ggpht.com", pathname: "/**" },
    ],
  },
};

export default nextConfig;
