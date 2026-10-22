"use client";

import { Moon, Sun } from "lucide-react";
import { useT } from "@/components/i18n";

const YEAR = 60 * 60 * 24 * 365;

export function ThemeToggle() {
  const tr = useT();
  return (
    <button
      onClick={(e) => {
        const apply = () => {
          const dark = document.documentElement.classList.toggle("dark");
          // Read back by the root layout on the next request, so SSR renders the
          // right theme. Swap for a Server Action if this ever needs HttpOnly.
          document.cookie = `theme=${dark ? "dark" : "light"};path=/;max-age=${YEAR};samesite=lax`;
        };

        // The old and new themes are painted as two stacked snapshots; the new
        // one is revealed by a circle growing out of this button. Unsupported
        // browsers and reduced-motion users just get the instant swap.
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduced || !document.startViewTransition) return apply();

        const { top, left, width, height } = e.currentTarget.getBoundingClientRect();
        const x = left + width / 2;
        const y = top + height / 2;
        const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

        document.documentElement.style.setProperty("--wipe-x", `${x}px`);
        document.documentElement.style.setProperty("--wipe-y", `${y}px`);
        document.documentElement.style.setProperty("--wipe-r", `${r}px`);
        document.startViewTransition(apply);
      }}
      aria-label={tr("Toggle theme")}
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      <Moon className="size-4 dark:hidden" />
      <Sun className="hidden size-4 dark:block" />
    </button>
  );
}
