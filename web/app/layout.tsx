import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { AuthProvider } from "../components/AuthProvider";
import { steerClerkAppearance } from "../lib/clerkAppearance";
import "./globals.css";

export const metadata: Metadata = {
  title: "Steer — Control room for Cursor & Claude Code",
  description:
    "Multiplayer rooms and headless issues for Cursor and Claude Code. Watch, steer, and let agents pick up tickets, open PRs, and write the note.",
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
      <html lang="en" className="dark scroll-smooth" style={{ colorScheme: "dark" }}>
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link
            rel="preconnect"
            href="https://fonts.gstatic.com"
            crossOrigin="anonymous"
          />
          <link
            href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
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
