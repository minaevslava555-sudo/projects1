"use client";

import WellnessEquipmentModal from "@/components/wellness-equipment-modal";
import { formatEuro } from "@/lib/booking-pricing";
import {
  MASSAGE_V1_TARIFFS,
  WELLNESS_EQUIPMENT,
  WELLNESS_EQUIPMENT_IDS,
  centsToEuro,
  type MassageV1TariffId,
  type WellnessEquipmentId,
} from "@/lib/massage-wellness-catalog";
import { useTranslations } from "next-intl";
import { useReducedMotion } from "motion/react";
import { useState } from "react";

const MASSAGE_CARDS: Array<{
  id: MassageV1TariffId;
  family?: "targeted";
}> = [
  { id: "relaxing-60" },
  { id: "sports-60" },
  { id: "targeted-60", family: "targeted" },
  { id: "premium-wellness-120" },
];

export default function MassageWellnessView({
  onBack,
  onBook,
}: {
  onBack: () => void;
  onBook: (tariffId?: MassageV1TariffId) => void;
}) {
  const t = useTranslations("MassageWellness");
  const tEquip = useTranslations("WellnessEquipment");
  const reduceMotion = useReducedMotion();
  const [targetedMinutes, setTargetedMinutes] = useState<30 | 60>(60);
  const [equipmentModalId, setEquipmentModalId] =
    useState<WellnessEquipmentId | null>(null);

  const motionClass = reduceMotion
    ? ""
    : "motion-safe:transition motion-safe:duration-500 motion-safe:ease-out";

  return (
    <section className="relative overflow-hidden border-b border-mist bg-paper">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#e7ddce_0%,_transparent_55%),linear-gradient(180deg,_#f7f5f0_0%,_#efe8dc_55%,_#e7ddce_100%)]" />

      <div className="relative mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20 lg:px-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={onBack}
            className="havenly-control inline-flex items-center border border-mist bg-white px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-olive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            {t("backToServices")}
          </button>
          <button
            type="button"
            onClick={() => onBook()}
            className="havenly-control inline-flex items-center bg-olive px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-olive-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            {t("bookCta")}
          </button>
        </div>

        <div className={`mt-12 max-w-2xl ${motionClass}`}>
          <p className="text-xs font-medium tracking-[0.26em] text-gold uppercase">
            {t("eyebrow")}
          </p>
          <h2 className="mt-4 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl lg:text-[2.75rem]">
            {t("heroTitle")}
          </h2>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-ink sm:text-lg">
            {t("heroTagline")}
          </p>
          <button
            type="button"
            onClick={() => onBook()}
            className="havenly-control mt-6 inline-flex items-center bg-olive px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-olive-deep"
          >
            {t("heroCta")}
          </button>
        </div>

        <div className="mt-16">
          <h3 className="font-display text-2xl font-medium text-ink sm:text-3xl">
            {t("discoverMassages")}
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
            {t("discoverMassagesIntro")}
          </p>

          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {MASSAGE_CARDS.map((card) => {
              const tariffId: MassageV1TariffId =
                card.family === "targeted"
                  ? targetedMinutes === 30
                    ? "targeted-30"
                    : "targeted-60"
                  : card.id;
              const tariff = MASSAGE_V1_TARIFFS[tariffId];
              return (
                <article
                  key={card.id}
                  className={`border border-mist/70 bg-white/50 p-5 shadow-[0_18px_40px_rgba(27,37,33,0.06)] ${motionClass}`}
                >
                  <h4 className="font-display text-xl font-medium text-ink">
                    {t(`tariffs.${tariffId}.title`)}
                  </h4>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    {t(`tariffs.${tariffId}.short`)}
                  </p>
                  <p className="mt-3 text-sm text-ink">
                    {t("duration", { minutes: tariff.durationMin })} ·{" "}
                    {formatEuro(centsToEuro(tariff.priceCents))}
                  </p>
                  {card.family === "targeted" ? (
                    <div className="mt-3 flex gap-2">
                      <p className="sr-only">{t("targetedToggleHint")}</p>
                      {([30, 60] as const).map((minutes) => (
                        <button
                          key={minutes}
                          type="button"
                          onClick={() => setTargetedMinutes(minutes)}
                          className={`havenly-control flex-1 border px-3 py-2 text-sm ${
                            targetedMinutes === minutes
                              ? "border-olive bg-olive/10"
                              : "border-mist bg-white"
                          }`}
                        >
                          {minutes} min
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {tariffId === "premium-wellness-120" ? (
                    <p className="mt-3 text-xs text-olive">
                      {t("includedDevices")}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onBook(tariffId)}
                    className="havenly-control mt-4 inline-flex bg-olive px-4 py-2.5 text-sm font-semibold text-white hover:bg-olive-deep"
                  >
                    {t("bookCta")}
                  </button>
                </article>
              );
            })}
          </div>
        </div>

        <div className="mt-20">
          <h3 className="font-display text-2xl font-medium text-ink sm:text-3xl">
            {t("discoverTech")}
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
            {t("discoverTechIntro")}
          </p>
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {WELLNESS_EQUIPMENT_IDS.map((id) => {
              const item = WELLNESS_EQUIPMENT[id];
              return (
                <article
                  key={id}
                  className={`overflow-hidden border border-mist/70 bg-white/50 shadow-[0_18px_40px_rgba(27,37,33,0.06)] ${motionClass}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.placeholderImage}
                    alt={tEquip(`items.${id}.imageAlt`)}
                    className="aspect-[5/4] w-full object-cover"
                  />
                  <div className="p-5">
                    <h4 className="font-display text-xl font-medium text-ink">
                      {tEquip(`items.${id}.name`)}
                    </h4>
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                      {tEquip(`items.${id}.short`)}
                    </p>
                    <p className="mt-3 text-sm text-ink">
                      {t("duration", { minutes: item.procedureMin })} · +
                      {formatEuro(centsToEuro(item.priceCents))}
                    </p>
                    <button
                      type="button"
                      onClick={() => setEquipmentModalId(id)}
                      className="havenly-control mt-4 inline-flex border border-mist bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:border-olive"
                    >
                      {tEquip("learnMore")}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <div className="mt-16 flex justify-center">
          <button
            type="button"
            onClick={() => onBook()}
            className="havenly-control inline-flex items-center bg-olive px-8 py-3.5 text-sm font-semibold text-white transition hover:bg-olive-deep sm:text-base"
          >
            {t("bookCta")}
          </button>
        </div>
      </div>

      <WellnessEquipmentModal
        equipmentId={equipmentModalId}
        open={equipmentModalId != null}
        onClose={() => setEquipmentModalId(null)}
        canAdd={false}
        alreadyIncluded={false}
      />
    </section>
  );
}
