"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { LANG_COOKIE, type Lang, parseLang, translate } from "../../lib/i18n";

type LanguageValue = { lang: Lang; t: (key: string, vars?: Record<string, string | number>) => string; setLang: (next: Lang) => void };

const LanguageContext = createContext<LanguageValue>({ lang: "en", t: (key) => translate("en", key), setLang: () => {} });

export const useLanguage = () => useContext(LanguageContext);

/** The language lives in a cookie so the server-rendered pages (settings,
 * documents, history) and the client agree without a round trip. Changing it
 * reloads, which is the honest way to re-render a whole document's direction. */
export function LanguageProvider({ initial, archive, children }: { initial: Lang; archive?: Partial<Record<Lang, string>>; children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);
  const setLang = useCallback((next: Lang) => {
    const chosen = parseLang(next);
    document.cookie = `${LANG_COOKIE}=${chosen}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    setLangState(chosen);
    window.location.reload();
  }, []);
  // every string may name the archive; {archive} resolves per language
  const value = useMemo<LanguageValue>(() => ({ lang, setLang, t: (key, vars) => translate(lang, key, { archive: archive?.[lang] ?? archive?.en ?? "", ...vars }) }), [lang, setLang, archive]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
