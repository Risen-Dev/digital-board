"use client";

import { TEMPLATES } from "@/lib/board";
import examples from "@/lib/template-examples.json";
import { useT } from "@/components/i18n";

/** Example tasks per column title, per template — only what the previews draw. */
const exampleCounts = Object.fromEntries(
  Object.entries(examples as Record<string, { tasks: { column: string }[] }>).map(([id, { tasks }]) => [
    id,
    tasks.reduce<Record<string, number>>((n, t) => ({ ...n, [t.column]: (n[t.column] ?? 0) + 1 }), {}),
  ]),
);

/**
 * Template cards with a mini-board preview. Native radios named `template`, so a
 * plain form submit carries the choice.
 */
export function TemplatePicker({
  value, onChange, withExamples,
}: {
  value: string;
  onChange: (id: string) => void;
  withExamples: boolean;
}) {
  const tr = useT();
  return (
    <div role="radiogroup" aria-label={tr("Template")} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {TEMPLATES.map((t) => {
        const on = t.id === value;
        return (
          <label
            key={t.id}
            className={`flex cursor-pointer flex-col gap-2 rounded-lg border p-3 transition-colors has-[:focus-visible]:border-ring ${
              on ? "border-primary bg-secondary" : "hover:bg-secondary/50"
            }`}
          >
            <input type="radio" name="template" value={t.id} checked={on} onChange={() => onChange(t.id)} className="sr-only" />
            <div className="flex h-14 gap-1 rounded-md border bg-background p-1.5" aria-hidden>
              {t.columns.map((c) => (
                <div key={c.title} title={c.title} className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="h-1 rounded-full" style={{ background: c.color }} />
                  {withExamples &&
                    Array.from({ length: Math.min(2, exampleCounts[t.id]?.[c.title] ?? 0) }, (_, i) => (
                      <div key={i} className="h-2.5 rounded-sm bg-muted-foreground/25" />
                    ))}
                </div>
              ))}
            </div>
            <div>
              <p className="text-xs font-medium">{tr(t.name)}</p>
              <p className="text-[11px] leading-snug text-muted-foreground">{tr(t.description)}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{t.columns.length} {tr("columns")}</p>
            </div>
          </label>
        );
      })}
    </div>
  );
}
