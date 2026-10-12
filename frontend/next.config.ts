import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Generated jewellery photos are served straight from R2's public bucket
    // domain (see backend/src/storage/r2.js's publicUrlFor) — next/image
    // refuses any remote host that isn't explicitly allow-listed.
    remotePatterns: [{ protocol: "https", hostname: "*.r2.dev" }],
    // Served as-is rather than through /_next/image: the optimizer has to
    // download each full-size PNG from r2.dev first, and its ~7s fetch
    // timeout kept failing on them (500s, broken thumbnails). Thumbnails
    // already have their own small `_thumb` copies in R2.
    unoptimized: true,
  },
};

export default nextConfig;
