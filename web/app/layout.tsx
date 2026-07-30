import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { AuthProvider } from "../components/AuthProvider";
import { steerClerkAppearance } from "../lib/clerkAppearance";
import "./globals.css";

export const metadata: Metadata = {
  title: "Steer — Shared live Cursor agent sessions",
  description:
    "Shared live Cursor agent sessions. Watch, redirect, and hand off control together.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider appearance={steerClerkAppearance}>
      <html lang="en" className="dark" style={{ colorScheme: "dark" }}>
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link
            rel="preconnect"
            href="https://fonts.gstatic.com"
            crossOrigin="anonymous"
          />
          <link
            href="https://db.onlinewebfonts.com/c/9d4d074c9335825a23cce178ee03b498?family=P22+Mackinac+W01+Book"
            rel="stylesheet"
          />
          <link
            href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
            rel="stylesheet"
          />
          <link
            rel="stylesheet"
            href="https://cdn.jsdelivr.net/npm/diff2html/bundles/css/diff2html.min.css"
          />
        </head>
        <body className="bg-[#141414] text-[#e4e4e4] antialiased">
          <AuthProvider>{children}</AuthProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
