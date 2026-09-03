import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The app router drops dot-directories, so the OAuth/MCP discovery
  // documents live under /well-known and the spec-mandated /.well-known
  // paths rewrite to them.
  async rewrites() {
    return [{ source: "/.well-known/:path*", destination: "/well-known/:path*" }];
  },
};

export default nextConfig;
