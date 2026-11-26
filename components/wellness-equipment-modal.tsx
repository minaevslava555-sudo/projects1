"use client";

import {
  WELLNESS_EQUIPMENT,
  centsToEuro,
  type WellnessEquipmentId,
  type WellnessFeatureId,
} from "@/lib/massage-wellness-catalog";
import { formatEuro } from "@/lib/booking-pricing";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

function FeatureIcon({ id }: { id: WellnessFeatureId }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    className: "h-4 w-4",
    "aria-hidden": true as const,
  };

  switch (id) {
    case "vibration-massage":
      return (
        <svg {...common}>
          <path d="M4 12h3M17 12h3M8 8l2 4-2 4M16 8l-2 4 2 4" />
        </svg>
      );
    case "infrared-heat":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
        </svg>
      );
    case "magnetic-field":
      return (
        <svg {...common}>
          <path d="M7 7v4a5 5 0 0 0 10 0V7" />
          <path d="M7 7h3v4a2 2 0 0 1-3 0V7ZM14 7h3v4a2 2 0 0 1-3 0V7Z" />
        </svg>
      );
    case "ionization":
      return (
        <svg {...common}>
          <circle cx="8" cy="12" r="2" />
          <circle cx="16" cy="9" r="1.5" />
          <circle cx="15" cy="16" r="1.5" />
          <path d="M10 12h3.2M14.2 10.2l1.2 1.2M14 14.5l1.3-1" />
        </svg>
      );
    case "stone-wellness":
      return (
        <svg {...common}>
          <path d="M7 16.5 12 6l5 10.5H7Z" />
          <path d="M9.2 16.5h5.6" />
        </svg>
      );
    case "ems":
      return (
        <svg {...common}>
          <path d="M4 12h4l2-5 3 10 2-5h5" />
        </svg>
      );
    case "blue-lllt":
    case "red-lllt":
      return (
        <svg {...common}>
          <path d="M9 19h6" />
          <path d="M12 3a2.5 2.5 0 0 0-2.5 2.5V12a2.5 2.5 0 1 0 5 0V5.5A2.5 2.5 0 0 0 12 3Z" />
        </svg>
      );
    case "moxibustion":
      return (
        <svg {...common}>
          <path d="M12 20V10" />
          <path d="M9.5 8.5c0-2 1.2-3.5 2.5-4.5 1.3 1 2.5 2.5 2.5 4.5 0 1.4-1.1 2.5-2.5 2.5S9.5 9.9 9.5 8.5Z" />
        </svg>
      );
    case "acupressure":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="12" r="6" strokeDasharray="2 3" />
        </svg>
      );
    case "health-music":
      return (
        <svg {...common}>
          <path d="M9 18V6l10-2v12" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="17" cy="16" r="2" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
        </svg>
      );
  }
}

function FeatureAccordion({
  featureIds,
  reduceMotion,
}: {
  featureIds: readonly WellnessFeatureId[];
  reduceMotion: boolean;
}) {
  const t = useTranslations("WellnessEquipment");
  const accordionId = useId();
  const [openFeatureId, setOpenFeatureId] = useState<WellnessFeatureId | null>(
    null,
  );

  return (
    <div>
      <h4 className="font-display text-xl font-medium text-ink">
        {t("technologiesHeading")}
      </h4>
      <ul className="mt-3 divide-y divide-mist/70 border-y border-mist/70">
        {featureIds.map((featureId) => {
          const expanded = openFeatureId === featureId;
          const buttonId = `${accordionId}-btn-${featureId}`;
          const panelId = `${accordionId}-panel-${featureId}`;
          return (
            <li key={featureId}>
              <button
                id={buttonId}
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() =>
                  setOpenFeatureId((prev) =>
                    prev === featureId ? null : featureId,
                  )
                }
                className="flex w-full items-start gap-3 py-3 text-left transition hover:bg-sand/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              >
                <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gold/35 bg-gold/10 text-gold">
                  <FeatureIcon id={featureId} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-ink">
                      {t(`features.${featureId}.title`)}
                    </span>
                    <span
                      className={`text-gold transition ${
                        expanded ? "rotate-45" : ""
                      }`}
                      aria-hidden="true"
                    >
                      +
                    </span>
                  </span>
                </span>
              </button>
              <div
                id={panelId}
                role="region"
                aria-labelledby={buttonId}
                aria-hidden={!expanded}
              >
                <AnimatePresence initial={false}>
                  {expanded ? (
                    <motion.div
                      key="blurb"
                      initial={
                        reduceMotion ? false : { opacity: 0, height: 0 }
                      }
                      animate={{ opacity: 1, height: "auto" }}
                      exit={
                        reduceMotion
                          ? undefined
                          : { opacity: 0, height: 0 }
                      }
                      transition={{
                        duration: reduceMotion ? 0 : 0.22,
                        ease: EASE,
                      }}
                      className="overflow-hidden pb-3 pl-11 text-sm leading-relaxed text-muted"
                    >
                      {t(`features.${featureId}.blurb`)}
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function WellnessEquipmentModal({
  equipmentId,
  open,
  onClose,
  onAdd,
  canAdd,
  alreadyIncluded,
}: {
  equipmentId: WellnessEquipmentId | null;
  open: boolean;
  onClose: () => void;
  onAdd?: (id: WellnessEquipmentId) => void;
  canAdd: boolean;
  alreadyIncluded?: boolean;
}) {
  const t = useTranslations("WellnessEquipment");
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => closeRef.current?.focus());

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  const item =
    open && equipmentId != null ? WELLNESS_EQUIPMENT[equipmentId] : null;

  let actions: ReactNode = null;
  if (item && equipmentId) {
    if (alreadyIncluded) {
      actions = (
        <p className="text-sm font-medium text-olive">{t("included")}</p>
      );
    } else if (canAdd && onAdd) {
      actions = (
        <button
          type="button"
          onClick={() => {
            onAdd(equipmentId);
            onClose();
          }}
          className="havenly-control bg-olive px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-olive-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          {t("addToMassage")}
        </button>
      );
    } else {
      actions = <p className="text-sm text-muted">{t("comingSoon")}</p>;
    }
  }

  return (
    <AnimatePresence>
      {open && equipmentId != null && item != null ? (
        <motion.div
          key="wellness-equipment-overlay"
          className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/45 p-0 sm:items-center sm:p-5"
          role="presentation"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
          transition={{
            duration: reduceMotion ? 0 : 0.22,
            ease: EASE,
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={
              reduceMotion ? false : { opacity: 0, y: 20, scale: 0.985 }
            }
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={
              reduceMotion
                ? undefined
                : { opacity: 0, y: 14, scale: 0.985 }
            }
            transition={{
              duration: reduceMotion ? 0 : 0.3,
              ease: EASE,
            }}
            className="relative flex max-h-[90dvh] w-full max-w-[1040px] flex-col overflow-hidden rounded-t-[12px] border border-mist bg-paper shadow-[0_28px_70px_rgba(27,37,33,0.2)] sm:rounded-[12px]"
          >
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label={t("closeAria")}
              className="havenly-control absolute top-3 right-3 z-20 inline-flex h-10 w-10 items-center justify-center border border-mist/80 bg-white/95 text-lg leading-none text-ink shadow-[0_8px_20px_rgba(27,37,33,0.08)] transition hover:border-olive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              ×
            </button>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="grid lg:grid-cols-[0.45fr_0.55fr]">
                <div className="space-y-3 bg-sand/40 p-4 sm:p-5 lg:sticky lg:top-0 lg:self-start">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-[12px] border border-mist/60 bg-sand">
                    <Image
                      src={item.image}
                      alt={t(`items.${equipmentId}.imageAlt`)}
                      fill
                      sizes="(max-width: 1024px) 100vw, 468px"
                      className="object-cover object-center"
                    />
                  </div>
                  <div className="relative aspect-[5/4] overflow-hidden rounded-[12px] border border-mist/60 bg-white">
                    <div className="absolute inset-4 sm:inset-5">
                      <Image
                        src={item.deviceImage}
                        alt={t(`items.${equipmentId}.deviceImageAlt`)}
                        fill
                        sizes="(max-width: 1024px) 100vw, 468px"
                        className="object-contain object-center"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-5 px-5 py-5 sm:px-7 sm:py-7">
                  <div className="pr-10">
                    <p className="text-[0.65rem] font-medium tracking-[0.24em] text-gold uppercase">
                      {t("eyebrow")}
                    </p>
                    <h3
                      id={titleId}
                      className="mt-2 font-display text-3xl font-medium tracking-tight text-ink"
                    >
                      {t(`items.${equipmentId}.name`)}
                    </h3>
                    <p className="mt-2 text-base font-medium text-olive sm:text-lg">
                      {t(`items.${equipmentId}.tagline`)}
                    </p>
                  </div>

                  <p className="text-sm leading-relaxed text-ink sm:text-[0.95rem]">
                    {t(`items.${equipmentId}.description`)}
                  </p>

                  <FeatureAccordion
                    key={equipmentId}
                    featureIds={item.featureIds}
                    reduceMotion={Boolean(reduceMotion)}
                  />

                  <div>
                    <h4 className="text-sm font-semibold tracking-wide text-olive">
                      {t("sessionHeading")}
                    </h4>
                    <dl className="mt-2 grid grid-cols-2 gap-3 rounded-[12px] border border-mist/70 bg-white/70 px-4 py-3 text-sm">
                      <div>
                        <dt className="text-muted">{t("duration")}</dt>
                        <dd className="mt-0.5 font-medium text-ink">
                          {t("minutes", { count: item.procedureMin })}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted">{t("extraPrice")}</dt>
                        <dd className="mt-0.5 font-medium text-ink">
                          +{formatEuro(centsToEuro(item.priceCents))}
                        </dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-muted">{t("extraBookingTime")}</dt>
                        <dd className="mt-0.5 font-medium text-ink">
                          {item.extraBookingMin > 0
                            ? t("minutes", { count: item.extraBookingMin })
                            : t("duringMassage")}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold tracking-wide text-olive">
                      {t("safetyHeading")}
                    </h4>
                    <p className="mt-2 text-xs leading-relaxed text-muted sm:text-sm">
                      {t(`items.${equipmentId}.limitations`)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {actions}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
