import type { NextConfig } from "next";

// Prefer explicit API_URL; never silently rewrite to localhost on Vercel.
const API_URL =
  process.env.API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.VERCEL ? "" : "http://localhost:3000");

if (process.env.VERCEL && !API_URL) {
  console.warn(
    "[next.config] Set API_URL or NEXT_PUBLIC_API_URL to your Render URL (e.g. https://….onrender.com). Rewrites to localhost are blocked on Vercel.",
  );
}

const nextConfig: NextConfig = {
  // standalone is for Docker; Vercel uses its own bundler
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
  async rewrites() {
    if (!API_URL) return [];
    return [
      {
        source: "/api/:path*",
        destination: `${API_URL}/api/:path*`,
      },
      {
        source: "/socket.io/:path*",
        destination: `${API_URL}/socket.io/:path*`,
      },
    ];
  },
};

export default nextConfig;
