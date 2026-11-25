"use client";

import {
  WELLNESS_EQUIPMENT,
  centsToEuro,
  type WellnessEquipmentId,
} from "@/lib/massage-wellness-catalog";
import { formatEuro } from "@/lib/booking-pricing";
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

  if (!open || equipmentId == null) return null;

  const item = WELLNESS_EQUIPMENT[equipmentId];

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/45 p-0 sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto border border-mist bg-paper shadow-[0_24px_60px_rgba(27,37,33,0.18)] sm:rounded-sm"
      >
        <div className="relative aspect-[5/4] overflow-hidden bg-[#efe8dc]">
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
            className="havenly-control absolute top-3 right-3 border border-mist bg-white/95 px-3 py-1.5 text-sm font-semibold text-ink"
          >
            {t("close")}
          </button>
        </div>
        <div className="space-y-4 px-5 py-5 sm:px-6">
          <div>
            <p className="text-xs tracking-[0.2em] text-gold uppercase">
              {t("eyebrow")}
            </p>
            <h3
              id={titleId}
              className="mt-2 font-display text-2xl font-medium text-ink"
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
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted">{t("duration")}</dt>
              <dd className="font-medium text-ink">
                {t("minutes", { count: item.procedureMin })}
              </dd>
            </div>
            <div>
              <dt className="text-muted">{t("extraPrice")}</dt>
              <dd className="font-medium text-ink">
                {formatEuro(centsToEuro(item.priceCents))}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-muted">{t("extraBookingTime")}</dt>
              <dd className="font-medium text-ink">
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
              <p className="text-sm font-medium text-olive">{t("included")}</p>
            ) : canAdd && onAdd ? (
              <button
                type="button"
                onClick={() => {
                  onAdd(equipmentId);
                  onClose();
                }}
                className="havenly-control bg-olive px-4 py-2.5 text-sm font-semibold text-white hover:bg-olive-deep"
              >
                {t("addToMassage")}
              </button>
            ) : (
              <p className="text-sm text-muted">{t("comingSoon")}</p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="havenly-control border border-mist bg-white px-4 py-2.5 text-sm font-semibold text-ink"
            >
              {t("close")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
