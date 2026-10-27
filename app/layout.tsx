import type { Metadata } from "next";
import { Inter, Noto_Serif, Plus_Jakarta_Sans, Shippori_Mincho } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { getLocale } from "@/lib/i18n/server";
import { I18nProvider } from "@/components/i18n";
import { PALETTES } from "@/lib/palettes";
import { UserBackground } from "@/components/theme-toggle";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
// Only the Iris, Shanshui and Kanagawa themes use these (see globals.css); next/font
// preloads nothing it isn't told to, so they cost a request only when shown.
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", preload: false });
const serif = Noto_Serif({ subsets: ["latin"], variable: "--font-serif", preload: false });
const mincho = Shippori_Mincho({ subsets: ["latin"], weight: "700", variable: "--font-mincho", preload: false });

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
  const jar = await cookies();
  const dark = jar.get("theme")?.value === "dark";
  const wanted = jar.get("palette")?.value;
  const palette = PALETTES.find((p) => p.id === wanted)?.id ?? PALETTES[0].id;
  const locale = await getLocale();

  return (
    <html lang={locale} data-theme={palette} className={`h-full antialiased ${inter.variable} ${jakarta.variable} ${serif.variable} ${mincho.variable} ${dark ? "dark" : ""}`}>
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <I18nProvider locale={locale}>{children}</I18nProvider>
        <UserBackground />
      </body>
    </html>
  );
}
