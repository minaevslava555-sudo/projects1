"use client";

import {
  WELLNESS_EQUIPMENT,
  centsToEuro,
  type WellnessEquipmentId,
} from "@/lib/massage-wellness-catalog";
import { formatEuro } from "@/lib/booking-pricing";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef } from "react";

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
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  const item =
    open && equipmentId != null ? WELLNESS_EQUIPMENT[equipmentId] : null;

  return (
    <AnimatePresence>
      {open && equipmentId != null && item != null ? (
        <motion.div
          key="wellness-equipment-overlay"
          className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/45 p-0 sm:items-center sm:p-6"
          role="presentation"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={
              reduceMotion ? false : { opacity: 0, y: 18, scale: 0.98 }
            }
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={
              reduceMotion
                ? undefined
                : { opacity: 0, y: 12, scale: 0.98 }
            }
            transition={{
              duration: reduceMotion ? 0 : 0.28,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[12px] border border-mist bg-paper shadow-[0_24px_60px_rgba(27,37,33,0.18)] sm:rounded-[12px]"
          >
            <div className="relative aspect-[5/4] overflow-hidden bg-sand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.placeholderImage}
                alt={t(`items.${equipmentId}.imageAlt`)}
                className="h-full w-full object-cover"
              />
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                className="havenly-control absolute top-3 right-3 border border-mist/80 bg-white/95 px-3 py-1.5 text-sm font-semibold text-ink shadow-[0_8px_20px_rgba(27,37,33,0.08)] transition hover:border-olive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              >
                {t("close")}
              </button>
            </div>
            <div className="space-y-4 px-5 py-5 sm:px-6 sm:py-6">
              <div>
                <p className="text-xs tracking-[0.2em] text-gold uppercase">
                  {t("eyebrow")}
                </p>
                <h3
                  id={titleId}
                  className="mt-2 font-display text-2xl font-medium tracking-tight text-ink"
                >
                  {t(`items.${equipmentId}.name`)}
                </h3>
              </div>
              <p className="text-sm leading-relaxed text-ink">
                {t(`items.${equipmentId}.purpose`)}
              </p>
              <p className="text-sm leading-relaxed text-muted">
                {t(`items.${equipmentId}.howItWorks`)}
              </p>
              <dl className="grid grid-cols-2 gap-3 rounded-[12px] border border-mist/70 bg-white/60 px-4 py-3 text-sm">
                <div>
                  <dt className="text-muted">{t("duration")}</dt>
                  <dd className="mt-0.5 font-medium text-ink">
                    {t("minutes", { count: item.procedureMin })}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">{t("extraPrice")}</dt>
                  <dd className="mt-0.5 font-medium text-ink">
                    {formatEuro(centsToEuro(item.priceCents))}
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
              <p className="text-xs leading-relaxed text-muted">
                {t(`items.${equipmentId}.limitations`)}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {alreadyIncluded ? (
                  <p className="text-sm font-medium text-olive">
                    {t("included")}
                  </p>
                ) : canAdd && onAdd ? (
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
                ) : (
                  <p className="text-sm text-muted">{t("comingSoon")}</p>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="havenly-control border border-mist bg-white px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-olive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                >
                  {t("close")}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
