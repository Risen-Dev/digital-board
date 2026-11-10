"use client";

import { createContext, useContext, useMemo } from "react";
import { useRouter } from "next/navigation";
import { LOCALE_NAMES, LOCALES, translator, type Locale } from "@/lib/i18n";

const LocaleContext = createContext<Locale>("en");

/** Set once in the root layout from the `lang` cookie, so server and client render the same words. */
export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export const useLocale = () => useContext(LocaleContext);

export function useT() {
  const locale = useContext(LocaleContext);
  return useMemo(() => translator(locale), [locale]);
}

const YEAR = 60 * 60 * 24 * 365;

/** Writes the `lang` cookie the root layout reads, then re-renders the server parts. */
export function LanguageSelect({ className = "" }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const tr = useT();
  return (
    <select
      value={locale}
      aria-label={tr("Language")}
      onChange={(e) => {
        document.cookie = `lang=${e.target.value};path=/;max-age=${YEAR};samesite=lax`;
        router.refresh();
      }}
      className={`rounded-md border bg-background px-2 py-1 text-xs outline-none focus:border-ring ${className}`}
    >
      {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
    </select>
  );
}
