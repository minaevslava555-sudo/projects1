"use client";

import { LOCALE_COOKIE, type AppLocale } from "@/i18n/config";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

function setLocaleCookie(locale: AppLocale) {
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${LOCALE_COOKIE}=${locale};path=/;max-age=${maxAge};samesite=lax`;
}

export default function LanguageSwitcher({
  className = "",
  tone = "onDark",
}: {
  className?: string;
  /** onDark for hero/header over olive; onLight for light surfaces */
  tone?: "onDark" | "onLight";
}) {
  const locale = useLocale();
  const t = useTranslations("Language");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const active = (locale === "pt-PT" ? "pt-PT" : "en") as AppLocale;

  function select(next: AppLocale) {
    if (next === active || pending) return;
    setLocaleCookie(next);
    startTransition(() => {
      router.refresh();
    });
  }

  const baseBtn =
    tone === "onDark"
      ? "border-white/30 text-white/75 hover:border-white/55 hover:text-white"
      : "border-mist text-muted hover:border-olive hover:text-ink";
  const activeBtn =
    tone === "onDark"
      ? "border-gold/70 bg-white/10 text-white"
      : "border-olive bg-olive/10 text-olive";

  return (
    <div
      className={`inline-flex items-center gap-1 ${className}`.trim()}
      role="group"
      aria-label={t("label")}
    >
      <button
        type="button"
        disabled={pending}
        aria-pressed={active === "en"}
        aria-label={t("switchToEn")}
        onClick={() => select("en")}
        className={`min-w-9 px-2 py-1.5 text-xs font-semibold tracking-[0.12em] transition disabled:opacity-60 ${
          active === "en" ? activeBtn : baseBtn
        } border`}
      >
        {t("en")}
      </button>
      <button
        type="button"
        disabled={pending}
        aria-pressed={active === "pt-PT"}
        aria-label={t("switchToPt")}
        onClick={() => select("pt-PT")}
        className={`min-w-9 px-2 py-1.5 text-xs font-semibold tracking-[0.12em] transition disabled:opacity-60 ${
          active === "pt-PT" ? activeBtn : baseBtn
        } border`}
      >
        {t("pt")}
      </button>
    </div>
  );
}
