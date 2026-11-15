import { createContext, createElement, useContext, useState, type ReactNode } from "react";
import en from "./en.json";
import gu from "./gu.json";

// Add a language: create its JSON file with the same keys as en.json, then register it here.
export const dictionaries: Record<string, Record<string, string>> = { en, gu };
export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "gu", label: "ગુજરાતી" },
] as const;

const STORAGE_KEY = "poetree_lang";
const readSaved = (): string => {
  try { const v = localStorage.getItem(STORAGE_KEY); return v && dictionaries[v] ? v : "en"; } catch { return "en"; }
};

// Translate a key using the given language, falling back to English, then to the key itself.
export function translate(lang: string, key: string): string {
  return dictionaries[lang]?.[key] ?? dictionaries.en[key] ?? key;
}

interface LangCtx { lang: string; setLang: (l: string) => void; t: (key: string) => string }
const Ctx = createContext<LangCtx>({ lang: "en", setLang: () => {}, t: (k) => translate("en", k) });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<string>(readSaved);
  const setLang = (l: string) => {
    if (!dictionaries[l]) return;
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* private mode: keep in memory only */ }
    document.documentElement.lang = l;
  };
  const value: LangCtx = { lang, setLang, t: (k) => translate(lang, k) };
  return createElement(Ctx.Provider, { value }, children);
}

// Components call useT() to get the translator for the current language; they re-render on change.
export const useT = () => useContext(Ctx);

export function LanguageSwitch() {
  const { lang, setLang } = useT();
  return createElement(
    "select",
    {
      value: lang,
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setLang(e.target.value),
      "aria-label": "Language",
      style: { minHeight: 36, width: "auto", padding: "4px 8px", background: "transparent", color: "#fff", borderColor: "#fff" },
    },
    LANGUAGES.map((l) => createElement("option", { key: l.code, value: l.code, style: { color: "#000" } }, l.label)),
  );
}
