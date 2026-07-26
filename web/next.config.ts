import type { NextConfig } from "next";

const API_URL = process.env.API_URL || "http://localhost:3000";

const nextConfig: NextConfig = {
  // standalone is for Docker; Vercel uses its own bundler
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_URL}/api/:path*`,
      },
      // HTTP-only fallback; browsers connect to NEXT_PUBLIC_SOCKET_URL for WS
      {
        source: "/socket.io/:path*",
        destination: `${API_URL}/socket.io/:path*`,
      },
    ];
  },
};

export default nextConfig;
