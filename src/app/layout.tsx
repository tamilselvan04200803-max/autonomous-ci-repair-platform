import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteNav } from "@/components/SiteNav";

export const metadata: Metadata = {
  title: "Aegis Forge — Evidence-Gated Autonomous CI Repair",
  description:
    "Aegis Forge repairs failing CI on its own — and publishes nothing until an independent evidence gate certifies the patch against a reproduced failure, a generated regression test, a risk score and a signed proof bundle.",
  keywords: [
    "CI repair",
    "autonomous CI",
    "evidence gate",
    "proof bundle",
    "SLSA attestation",
    "GitHub Checks",
    "Temporal",
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..700&family=Space+Grotesk:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="grain min-h-screen bg-paper text-ink antialiased">
        <a
          href="#main"
          className="label sr-only focus:not-sr-only focus:absolute focus:left-6 focus:top-6 focus:z-[100] focus:bg-ink focus:px-6 focus:py-4 focus:text-paper"
        >
          Skip to content
        </a>
        <SiteNav />
        <main id="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
