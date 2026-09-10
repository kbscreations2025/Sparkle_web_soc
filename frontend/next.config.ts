import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Generated jewellery photos are served straight from R2's public bucket
    // domain (see backend/src/storage/r2.js's publicUrlFor) — next/image
    // refuses any remote host that isn't explicitly allow-listed.
    remotePatterns: [{ protocol: "https", hostname: "*.r2.dev" }],
  },
};

export default nextConfig;
