"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ImageIcon, Moon, Sun, Trash2, Upload } from "lucide-react";
import { useT } from "@/components/i18n";
import { PALETTES, type Palette } from "@/lib/palettes";

const YEAR = 60 * 60 * 24 * 365;

/**
 * Runs `apply` inside a view transition: the old look stays put and the new one
 * is revealed over it. "circle" grows from `from`; "scroll" unrolls right to
 * left like a handscroll; "tide" rises from the bottom. Unsupported browsers and reduced motion get the cut.
 */
function reveal(from: HTMLElement, apply: () => void, wipe: "circle" | "scroll" | "tide" = "circle") {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || !document.startViewTransition) return apply();

  const { top, left, width, height } = from.getBoundingClientRect();
  const x = left + width / 2;
  const y = top + height / 2;
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const root = document.documentElement;
  root.style.setProperty("--wipe-x", `${x}px`);
  root.style.setProperty("--wipe-y", `${y}px`);
  root.style.setProperty("--wipe-r", `${r}px`);
  root.dataset.wipe = wipe;
  document.startViewTransition(apply).finished.finally(() => delete root.dataset.wipe);
}

function setDark(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  // Read back by the root layout on the next request, so SSR renders the
  // right theme. Swap for a Server Action if this ever needs HttpOnly.
  document.cookie = `theme=${dark ? "dark" : "light"};path=/;max-age=${YEAR};samesite=lax`;
}

// The picture lives in this browser only, like the theme cookies. Downscaled
// JPEG data URL so it fits localStorage (~5 MB); fade and the sidebar switch
// are stored apart so changing them doesn't rewrite the picture.
const BG_KEY = "board-bg";
const VEIL_KEY = "board-bg-veil";
const SIDEBAR_KEY = "board-bg-sidebar";
const MAX_SIDE = 2560;

type Bg = { src: string | null; veil: number; sidebar: boolean };
const NO_BG: Bg = { src: null, veil: 60, sidebar: false };

function readBg(): Bg {
  try {
    return {
      src: localStorage.getItem(BG_KEY),
      veil: Number(localStorage.getItem(VEIL_KEY) ?? NO_BG.veil),
      sidebar: localStorage.getItem(SIDEBAR_KEY) === "1",
    };
  } catch {
    return NO_BG;
  }
}

/** Puts the picture behind every `.theme-backdrop`, the sidebar only on request (see globals.css). */
function applyBg({ src, veil, sidebar }: Bg) {
  const root = document.documentElement;
  root.style.setProperty("--bg-veil", `${veil}%`);
  root.toggleAttribute("data-bg-sidebar", sidebar);
  root.toggleAttribute("data-bg", !!src);
  if (src) root.style.setProperty("--user-bg", `url("${src}")`);
  else root.style.removeProperty("--user-bg");
}

async function shrink(file: File) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * k);
  canvas.height = Math.round(img.height * k);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  img.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

/** Mounted once in the root layout: restores the saved picture on every page. */
export function UserBackground() {
  useEffect(() => {
    const bg = readBg();
    if (bg.src) applyBg(bg);
  }, []);
  return null;
}

export function ThemeToggle() {
  const tr = useT();
  return (
    <button
      onClick={(e) => reveal(e.currentTarget, () => setDark(!document.documentElement.classList.contains("dark")))}
      aria-label={tr("Toggle theme")}
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      <Moon className="size-4 dark:hidden" />
      <Sun className="hidden size-4 dark:block" />
    </button>
  );
}

/** A tiny board drawn with the palette's own tokens: `data-theme` scopes them to this box. */
function Preview({ id }: { id: Palette }) {
  return (
    <div data-theme={id} className="theme-backdrop flex h-28 gap-1.5 overflow-hidden rounded-[calc(var(--radius)*1.2)] border bg-background p-2 text-foreground">
      <div className="flex w-8 shrink-0 flex-col gap-1 border-r pr-1.5">
        <span className="size-3 rounded-[calc(var(--radius)*0.5)] bg-primary" />
        <span className="h-1.5 rounded-full bg-secondary" />
        <span className="h-1.5 rounded-full bg-muted-foreground/30" />
        <span className="h-1.5 rounded-full bg-muted-foreground/30" />
      </div>
      {[3, 2, 1].map((cards, col) => (
        <div key={col} className="flex flex-1 flex-col gap-1 rounded-[calc(var(--radius)*0.8)] bg-secondary/70 p-1">
          <span className="h-1 w-1/2 rounded-full bg-muted-foreground/50" />
          {Array.from({ length: cards }, (_, i) => (
            <span key={i} className="flex flex-col gap-0.5 rounded-[calc(var(--radius)*0.6)] border bg-card p-1 shadow-sm">
              <span className="h-1 w-4/5 rounded-full bg-foreground/70" />
              <span className={`h-1 w-1/3 rounded-full ${i === 0 ? "bg-primary" : "bg-[var(--chart-2)]"}`} />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Settings → Appearance. Everything here is kept per browser. */
export function ThemePicker() {
  const tr = useT();
  // Only rendered after the user opens the tab, so the DOM is there to read.
  const [palette, setPalette] = useState<Palette>(
    () => (typeof document === "undefined" ? "graphite" : (document.documentElement.dataset.theme as Palette)) ?? "graphite",
  );

  const pick = (id: Palette, from: HTMLElement) => {
    if (id === palette) return;
    reveal(from, () => {
      document.documentElement.dataset.theme = id;
      document.cookie = `palette=${id};path=/;max-age=${YEAR};samesite=lax`;
      setPalette(id);
    }, id === "shanshui" ? "scroll" : id === "kanagawa" ? "tide" : "circle");
  };

  // Same reasoning as `palette`: localStorage is there by the time this renders.
  const [bg, setBg] = useState(() => (typeof window === "undefined" ? NO_BG : readBg()));
  const [bgError, setBgError] = useState<string | null>(null);
  const thumb = useRef<HTMLDivElement>(null);

  const setPicture = (src: string | null) => {
    try {
      if (src) localStorage.setItem(BG_KEY, src);
      else localStorage.removeItem(BG_KEY);
    } catch {
      return setBgError(tr("This image is too large to keep in this browser. Try a smaller one."));
    }
    setBgError(null);
    reveal(thumb.current!, () => {
      applyBg({ ...bg, src });
      setBg({ ...bg, src });
    });
  };

  /** Fade and the sidebar switch: small values, saved as they change. */
  const tune = (next: Bg, key: string, value: string, from?: HTMLElement) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Still applies for this visit.
    }
    const apply = () => {
      applyBg(next);
      setBg(next);
    };
    if (from) reveal(from, apply);
    else apply();
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      setPicture(await shrink(file));
    } catch {
      setBgError(tr("That file isn't an image this browser can read."));
    }
  };

  const mode = "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all";
  return (
    <>
      <label className="mb-1.5 block text-xs font-medium">{tr("Mode")}</label>
      <div className="flex max-w-xs gap-1 rounded-lg border bg-card p-1">
        <button onClick={(e) => reveal(e.currentTarget, () => setDark(false))} className={`${mode} bg-secondary text-foreground dark:bg-transparent dark:text-muted-foreground dark:hover:text-foreground`}>
          <Sun className="size-3.5" /> {tr("Light")}
        </button>
        <button onClick={(e) => reveal(e.currentTarget, () => setDark(true))} className={`${mode} text-muted-foreground hover:text-foreground dark:bg-secondary dark:text-foreground`}>
          <Moon className="size-3.5" /> {tr("Dark")}
        </button>
      </div>

      <label className="mb-1.5 mt-6 block text-xs font-medium">{tr("Theme")}</label>
      <div className="grid gap-3 sm:grid-cols-2">
        {PALETTES.map(({ id, name, hint }, i) => {
          const on = id === palette;
          return (
            <button
              key={id}
              onClick={(e) => pick(id, e.currentTarget)}
              aria-pressed={on}
              style={{ animationDelay: `${i * 50}ms` }}
              className={`group relative rounded-xl border bg-card p-2 text-left fill-mode-backwards animate-in fade-in slide-in-from-bottom-2 duration-300 transition-[box-shadow,translate,border-color] hover:-translate-y-0.5 hover:shadow-md ${
                on ? "border-primary ring-2 ring-primary/30" : "hover:border-ring"
              }`}
            >
              <Preview id={id} />
              <div className="flex items-start gap-2 px-1 pb-1 pt-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{name}</p>
                  <p className="text-[11px] leading-snug text-muted-foreground">{tr(hint)}</p>
                </div>
                {on && (
                  <span key={id} className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground animate-in zoom-in-50 spin-in-12 duration-300">
                    <Check className="size-3" />
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <label className="mb-1.5 mt-6 block text-xs font-medium">{tr("Background")}</label>
      <div className="flex items-center gap-3 rounded-lg border bg-card p-2">
        <div
          ref={thumb}
          key={bg.src?.length ?? 0}
          style={bg.src ? { backgroundImage: `url("${bg.src}")` } : undefined}
          className="relative flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-secondary bg-cover bg-center text-muted-foreground animate-in fade-in zoom-in-95 duration-300"
        >
          {bg.src ? (
            // The same veil the page gets, so the thumbnail shows the real result.
            <span className="absolute inset-0 bg-background" style={{ opacity: bg.veil / 100 }} />
          ) : (
            <ImageIcon className="size-5" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-[opacity,scale] hover:opacity-90 active:scale-[0.97] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
              <Upload className="size-3.5" /> {tr(bg.src ? "Replace" : "Upload image")}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  upload(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {bg.src && (
              <button onClick={() => setPicture(null)} className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-secondary animate-in fade-in slide-in-from-left-1 duration-200">
                <Trash2 className="size-3.5" /> {tr("Remove")}
              </button>
            )}
          </div>
          {bg.src && (
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground animate-in fade-in duration-200">
              {tr("Fade")}
              <input type="range" min={0} max={90} step={5} value={bg.veil} onChange={(e) => tune({ ...bg, veil: Number(e.target.value) }, VEIL_KEY, e.target.value)} className="min-w-0 flex-1 accent-[var(--primary)]" />
              <span className="w-8 text-right tabular-nums">{bg.veil}%</span>
            </label>
          )}
          {bg.src && (
            <button
              role="switch"
              aria-checked={bg.sidebar}
              onClick={(e) => tune({ ...bg, sidebar: !bg.sidebar }, SIDEBAR_KEY, bg.sidebar ? "0" : "1", e.currentTarget)}
              className="flex items-center gap-2 self-start text-[11px] text-muted-foreground transition-colors hover:text-foreground animate-in fade-in duration-200"
            >
              <span className={`flex h-4 w-7 items-center rounded-full p-0.5 transition-colors duration-200 ${bg.sidebar ? "bg-primary" : "bg-muted-foreground/30"}`}>
                <span className={`size-3 rounded-full bg-background shadow-sm transition-transform duration-200 ease-out ${bg.sidebar ? "translate-x-3" : ""}`} />
              </span>
              {tr("Behind the sidebar too")}
            </button>
          )}
        </div>
      </div>
      {bgError ? (
        <p className="mt-1.5 text-[11px] text-destructive animate-in fade-in slide-in-from-top-1 duration-200">{bgError}</p>
      ) : (
        <p className="mt-1.5 text-[11px] text-muted-foreground">{tr("Shown behind the board, over any theme motif. Fade keeps text readable.")}</p>
      )}
      <p className="mt-4 text-[11px] text-muted-foreground">{tr("Only for you, on this browser.")}</p>
    </>
  );
}
