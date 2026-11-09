import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
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
