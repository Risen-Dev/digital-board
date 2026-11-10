"use client";

import { useState } from "react";
import { Bookmark, Plus, X } from "lucide-react";
import { sameFilters, type Filters, type Layout, type SavedView } from "@/lib/board";
import { deleteView, saveView } from "@/lib/actions";
import { useT } from "@/components/i18n";

/**
 * The project's saved views as chips at the start of the filter bar: a click
 * applies its filters and layout; "Save view" stores the current ones by name
 * (the same name overwrites). Shared with everyone in the project.
 */
export function SavedViews({ projectId, views, filters, layout, readOnly, onApply }: {
  projectId: string;
  views: SavedView[];
  filters: Filters;
  layout: Layout;
  readOnly: boolean;
  onApply: (view: SavedView) => void;
}) {
  const tr = useT();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const r = await saveView(projectId, name, filters, layout);
    if (r.error) return setError(r.error);
    setNaming(false);
    setName("");
  }

  return (
    <>
      <Bookmark className="size-3.5 shrink-0 text-muted-foreground" aria-label={tr("Saved views")} />
      {views.map((v) => {
        const active = v.layout === layout && sameFilters(v.filters, filters);
        return (
          <span key={v.id} className={`group flex items-center rounded-md border ${active ? "border-primary bg-background font-medium" : "text-muted-foreground"}`}>
            <button onClick={() => onApply(v)} className="px-2 py-1 transition-colors hover:text-foreground">
              {v.name}
            </button>
            {!readOnly && (
              <button
                onClick={() => void deleteView(v.id)}
                aria-label={tr("Delete view {name}", { name: v.name })}
                className="hidden pr-1.5 text-muted-foreground hover:text-foreground group-hover:block"
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        );
      })}
      {!readOnly && (naming ? (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) void save();
            if (e.key === "Escape") setNaming(false);
          }}
          onBlur={() => !name.trim() && setNaming(false)}
          placeholder={tr("View name, then Enter")}
          className="w-40 rounded-md border bg-background px-2 py-1 outline-none focus:border-ring"
        />
      ) : (
        <button
          onClick={() => setNaming(true)}
          title={tr("Save the current filters and layout for everyone in this project")}
          className="flex items-center gap-1 rounded-md border border-dashed px-2 py-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Plus className="size-3" />
          {tr("Save view")}
        </button>
      ))}
      {error && <span className="text-[var(--chart-7)]">{tr(error)}</span>}
      <span className="mx-1 h-4 w-px bg-border" />
    </>
  );
}
