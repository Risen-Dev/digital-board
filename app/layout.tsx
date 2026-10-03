import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Workspace — Digital Board",
  description: "Boards, sprints, docs, and automations, unified in one clean tool.",
  // The app has its own dark theme. Without this, Dark Reader rewrites every SVG and
  // inline style before hydration and React reports a mismatch on each one.
  other: { "darkreader-lock": "true" },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Theme is a cookie so the server can render the right class on the first
  // byte. No pre-paint inline script, so no flash and nothing for React to
  // warn about. See components/theme-toggle.tsx for the write side.
  const dark = (await cookies()).get("theme")?.value === "dark";

  return (
    <html lang="en" className={`h-full antialiased ${inter.variable} ${dark ? "dark" : ""}`}>
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        {children}
      </body>
    </html>
  );
}
