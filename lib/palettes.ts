/** Token sets in app/globals.css, keyed by `data-theme` on <html>. First one is the default. */
export const PALETTES = [
  { id: "graphite", name: "Graphite", hint: "Neutral and quiet. The original look." },
  { id: "harbor", name: "Harbor", hint: "Cobalt on cool slate, crisp cards. Built for busy boards." },
  { id: "iris", name: "Iris", hint: "Soft violet, rounder corners. Friendly for long sprints." },
  { id: "shanshui", name: "Shanshui", hint: "Azurite and malachite on silk, after A Thousand Li of Rivers and Mountains." },
  { id: "kanagawa", name: "Kanagawa", hint: "Prussian blue on washi, after Hokusai's Thirty-six Views of Mount Fuji." },
] as const;
export type Palette = (typeof PALETTES)[number]["id"];
