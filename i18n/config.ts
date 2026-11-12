/** Supported locales for HAVENLY (cookie-based, no URL prefix). */
export const locales = ["en", "pt-PT"] as const;
export type AppLocale = (typeof locales)[number];
export const defaultLocale: AppLocale = "en";
export const LOCALE_COOKIE = "havenly_locale";

export function isAppLocale(value: string | undefined | null): value is AppLocale {
  return !!value && (locales as readonly string[]).includes(value);
}

/** BCP 47 tag for <html lang>. */
export function htmlLang(locale: AppLocale): string {
  return locale === "pt-PT" ? "pt-PT" : "en";
}
