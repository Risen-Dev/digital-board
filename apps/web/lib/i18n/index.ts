import id from "./id";
import { translator as from, type Locale } from "./core";

export * from "./core";

const DICTS: Record<Locale, Record<string, string>> = { en: {}, id };

export const translator = (locale: Locale) => from(DICTS[locale]);
