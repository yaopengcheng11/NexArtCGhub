import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { en, type DictKey } from './dictionaries';
import { zh } from './zh';

export type Locale = 'en' | 'zh';
const STORAGE_KEY = 'cg-hub.locale';

// Build a strictly-typed `dictionaries` map from the typed const dicts.
// Each locale is typed as `Record<DictKey, string>`, so a missing key
// in any locale is a compile error.
const dictionaries: Record<Locale, Record<DictKey, string>> = { en, zh };

// Dev-time drift check is now mostly redundant with the TS constraint
// above (which already enforces parity at compile time), but we keep
// the runtime warning as a safety net for cases where a key is added to
// en.ts with the value `undefined` or `''`.
// Dev-only: this scans both dicts every page load; in production the
// TS constraint (Record<DictKey, string>) already guarantees parity at
// build time, so the runtime scan is dead weight.
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  const enKeys = Object.keys(en) as DictKey[];
  const zhKeys = new Set(Object.keys(zh));
  const onlyEn: DictKey[] = enKeys.filter((k) => !zhKeys.has(k));
  const onlyZh: string[] = Object.keys(zh).filter((k) => !(k in en));
  if (onlyEn.length || onlyZh.length) {
    // eslint-disable-next-line no-console
    console.warn(
      '[i18n] Dictionary drift detected!\n' +
        (onlyEn.length ? '  in en but missing in zh: ' + onlyEn.join(', ') + '\n' : '') +
        (onlyZh.length ? '  in zh but missing in en: ' + onlyZh.join(', ') + '\n' : '') +
        '  Keep en and zh dictionaries in sync — see cg-resource-hub-hip-path-surgeon.md.',
    );
  }
}

type Vars = Record<string, string | number>;

interface I18nContextType {
  locale: Locale;
  setLocale: (l: Locale) => void;
  /**
   * Translation lookup. Typed against DictKey but accepts string for
   * compatibility with dynamic keys (e.g. t(`some.${suffix}`) where
   * suffix isn't a literal). Missing keys fall back to en, then to the
   * raw key string (which is a visible dev signal).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: (key: DictKey | (string & {}), vars?: Vars) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

function detectInitialLocale(): Locale {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {}
  try {
    const lang = window.navigator?.language?.toLowerCase() || '';
    if (lang.startsWith('zh')) return 'zh';
  } catch {}
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectInitialLocale());

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
      document.documentElement.lang = locale;
    } catch {}
  }, [locale]);

  const value = useMemo<I18nContextType>(() => {
    const setLocale = (l: Locale) => setLocaleState(l);
    const t = (key: DictKey | (string & {}), vars?: Vars): string => {
      // Allow strings for dynamic keys (back-compat) — TS still gets the
      // autocomplete benefit of DictKey when it's a literal.
      const k = key as DictKey;
      const raw =
        dictionaries[locale][k] ??
        dictionaries.en[k] ??
        key;
      if (!vars) return raw;
      return raw.replace(/\{(\w+)\}/g, (_m: string, name: string) =>
        vars[name] != null ? String(vars[name]) : `{${name}}`,
      );
    };
    return { locale, setLocale, t };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be inside I18nProvider');
  return ctx;
}
