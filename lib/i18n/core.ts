/**
 * UI translation without a library. The English text is the key, so a string
 * nobody has translated yet simply shows in English, and messages the server
 * returns in English (form errors) translate on the client the same way.
 * `{name}` placeholders are filled from `vars`.
 */
export const LOCALES = ["en", "id"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", id: "Bahasa Indonesia" };

export type Translate = (text: string, vars?: Record<string, string | number>) => string;

/** `dict` maps English text to the translation; anything missing comes back in English. */
export function translator(dict: Record<string, string>): Translate {
  return (text, vars) => {
    let out = dict[text] ?? text;
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
    return out;
  };
}

/** The `lang` cookie if set, else the browser's first language, else English. */
export function pickLocale(cookie: string | undefined, acceptLanguage: string | null): Locale {
  if (cookie === "en" || cookie === "id") return cookie;
  return /^\s*(id|in)\b/i.test(acceptLanguage ?? "") ? "id" : "en";
}

/**
 * Card history is stored as English sentences (lib/actions.ts writes them). These
 * patterns turn the ones with a value inside into translatable templates; fixed
 * ones ("Task created") go straight through `tr`. Comments are never passed here.
 */
const EVENTS: [RegExp, string, string[]][] = [
  [/^Moved from (.+) to (.+)$/, "Moved from {from} to {to}", ["from", "to"]],
  [/^Reordered in (.+)$/, "Reordered in {column}", ["column"]],
  [/^Priority changed to (.+)$/, "Priority changed to {value}", ["value"]],
  [/^Title changed to (.+)$/, "Title changed to {value}", ["value"]],
  [/^Due date set to (.+)$/, "Due date set to {value}", ["value"]],
  [/^Start date set to (.+)$/, "Start date set to {value}", ["value"]],
  [/^Added to (.+)$/, "Added to {sprint}", ["sprint"]],
  [/^Carried over from (.+) to (.+)$/, "Carried over from {from} to {to}", ["from", "to"]],
  [/^Moved to the backlog when (.+) ended$/, "Moved to the backlog when {sprint} ended", ["sprint"]],
  [/^Labels set to (.+)$/, "Labels set to {value}", ["value"]],
  [/^Assigned to (.+)$/, "Assigned to {value}", ["value"]],
  [/^Repeats (\w+)$/, "Repeats {value}", ["value"]],
  [/^Blocked by (.+)$/, "Blocked by {key}", ["key"]],
  [/^No longer blocked by (.+)$/, "No longer blocked by {key}", ["key"]],
  [/^(\S+) is done$/, "{key} is done", ["key"]],
  [/^Commented: ([\s\S]*)$/, "Commented: {text}", ["text"]],
  [/^Automation: assigned to (.+)$/, "Automation: assigned to {value}", ["value"]],
  [/^Automation: priority set to (.+)$/, "Automation: priority set to {value}", ["value"]],
  [/^Automation: label (.+) added$/, "Automation: label {value} added", ["value"]],
  [/^Automation: due date set to (.+)$/, "Automation: due date set to {value}", ["value"]],
];

export function eventText(text: string, tr: Translate) {
  for (const [re, key, names] of EVENTS) {
    const m = re.exec(text);
    if (m) return tr(key, Object.fromEntries(names.map((n, i) => [n, m[i + 1]])));
  }
  return tr(text);
}
