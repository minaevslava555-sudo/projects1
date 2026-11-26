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
import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useState } from "react";

const MASSAGE_CARDS: Array<{
  id: MassageV1TariffId;
  family?: "targeted";
  signature?: boolean;
}> = [
  { id: "relaxing-60" },
  { id: "sports-60" },
  { id: "targeted-60", family: "targeted" },
  { id: "premium-wellness-120", signature: true },
];

const EASE = [0.22, 1, 0.36, 1] as const;

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
  const cardHoverClass = reduceMotion
    ? ""
    : "hover:-translate-y-0.5 hover:shadow-[0_22px_48px_rgba(27,37,33,0.1)]";
  const imageHoverClass = reduceMotion
    ? ""
    : "transition duration-[1.1s] ease-out group-hover:scale-[1.03]";

  return (
    <section className="relative overflow-hidden border-b border-mist bg-paper">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#e7ddce_0%,_transparent_55%),linear-gradient(180deg,_#f7f5f0_0%,_#efe8dc_55%,_#e7ddce_100%)]" />

      <div className="relative mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20 lg:px-10">
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={onBack}
            className="havenly-control inline-flex items-center border border-mist bg-white px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-olive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            {t("backToServices")}
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
            className="havenly-control mt-6 inline-flex items-center bg-olive px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-olive-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
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

          <div className="mt-8 grid gap-5 sm:grid-cols-2 sm:gap-6">
            {MASSAGE_CARDS.map((card, index) => {
              const tariffId: MassageV1TariffId =
                card.family === "targeted"
                  ? targetedMinutes === 30
                    ? "targeted-30"
                    : "targeted-60"
                  : card.id;
              const tariff = MASSAGE_V1_TARIFFS[tariffId];
              const isSignature = card.signature === true;
              const title = t(`tariffs.${tariffId}.title`);

              return (
                <motion.article
                  key={card.id}
                  initial={reduceMotion ? false : { opacity: 0, y: 18 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{
                    duration: reduceMotion ? 0 : 0.55,
                    delay: reduceMotion ? 0 : index * 0.06,
                    ease: EASE,
                  }}
                  className={`group overflow-hidden rounded-[12px] border shadow-[0_18px_40px_rgba(27,37,33,0.06)] ${motionClass} ${cardHoverClass} ${
                    isSignature
                      ? "border-olive-deep/40 bg-olive text-paper"
                      : "border-mist/70 bg-white/55"
                  }`}
                >
                  <div className="relative aspect-[5/4] overflow-hidden bg-sand">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={tariff.image}
                      alt={t("imageAlt", { title })}
                      className={`absolute inset-0 h-full w-full object-cover ${imageHoverClass}`}
                    />
                    <div
                      className={`absolute inset-0 ${
                        isSignature
                          ? "bg-gradient-to-t from-olive-deep/75 via-olive/20 to-transparent"
                          : "bg-gradient-to-t from-ink/35 via-transparent to-transparent"
                      }`}
                    />
                    {isSignature ? (
                      <p className="absolute top-4 left-4 text-[0.65rem] font-medium tracking-[0.22em] text-gold uppercase">
                        {t("signatureEyebrow")}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-1 flex-col px-5 py-5 sm:px-6 sm:py-6">
                    {isSignature ? (
                      <div
                        className="mb-3 h-px w-10 bg-gold/70"
                        aria-hidden="true"
                      />
                    ) : null}
                    <h4
                      className={`font-display text-xl font-medium tracking-tight sm:text-2xl ${
                        isSignature ? "text-paper" : "text-ink"
                      }`}
                    >
                      {title}
                    </h4>
                    <p
                      className={`mt-2 text-sm leading-relaxed ${
                        isSignature ? "text-paper/80" : "text-muted"
                      }`}
                    >
                      {t(`tariffs.${tariffId}.short`)}
                    </p>

                    <p
                      className={`mt-4 text-sm font-medium ${
                        isSignature ? "text-gold" : "text-ink"
                      }`}
                    >
                      {t("duration", { minutes: tariff.durationMin })} ·{" "}
                      {formatEuro(centsToEuro(tariff.priceCents))}
                    </p>

                    {card.family === "targeted" ? (
                      <div className="mt-4 flex gap-2">
                        <p className="sr-only">{t("targetedToggleHint")}</p>
                        {([30, 60] as const).map((minutes) => (
                          <button
                            key={minutes}
                            type="button"
                            onClick={() => setTargetedMinutes(minutes)}
                            className={`havenly-control flex-1 border px-3 py-2 text-sm font-medium transition ${
                              targetedMinutes === minutes
                                ? "border-olive bg-olive/10 text-ink"
                                : "border-mist bg-white text-ink hover:border-olive/50"
                            }`}
                          >
                            {minutes} min
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {isSignature ? (
                      <p className="mt-3 text-xs leading-relaxed text-paper/70">
                        {t("includedDevices")}
                      </p>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => onBook(tariffId)}
                      className={`havenly-control mt-5 inline-flex w-fit px-5 py-2.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ${
                        isSignature
                          ? "bg-sand text-olive hover:bg-paper"
                          : "bg-olive text-white hover:bg-olive-deep"
                      }`}
                    >
                      {t("bookCta")}
                    </button>
                  </div>
                </motion.article>
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
          <div className="mt-8 grid gap-5 sm:grid-cols-2 sm:gap-5 lg:gap-6">
            {WELLNESS_EQUIPMENT_IDS.map((id, index) => {
              const item = WELLNESS_EQUIPMENT[id];
              return (
                <motion.article
                  key={id}
                  initial={reduceMotion ? false : { opacity: 0, y: 18 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{
                    duration: reduceMotion ? 0 : 0.55,
                    delay: reduceMotion ? 0 : index * 0.06,
                    ease: EASE,
                  }}
                  className={`group overflow-hidden rounded-[12px] border border-mist/70 bg-white/55 shadow-[0_18px_40px_rgba(27,37,33,0.06)] ${motionClass} ${cardHoverClass}`}
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-sand sm:aspect-[3/2]">
                    <Image
                      src={item.image}
                      alt={tEquip(`items.${id}.imageAlt`)}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 560px"
                      className={`object-cover object-[center_30%] ${imageHoverClass}`}
                    />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/25 via-transparent to-transparent" />
                  </div>
                  <div className="px-5 py-4 sm:px-5 sm:py-5">
                    <h4 className="font-display text-xl font-medium tracking-tight text-ink sm:text-[1.35rem]">
                      {tEquip(`items.${id}.name`)}
                    </h4>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted">
                      {tEquip(`items.${id}.short`)}
                    </p>
                    <p className="mt-3 text-sm font-medium text-ink">
                      {t("duration", { minutes: item.procedureMin })} · +
                      {formatEuro(centsToEuro(item.priceCents))}
                    </p>
                    <button
                      type="button"
                      onClick={() => setEquipmentModalId(id)}
                      className="havenly-control group/cta mt-4 inline-flex items-center gap-2 border border-transparent bg-transparent px-0 py-1.5 text-sm font-semibold text-olive transition hover:text-olive-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                    >
                      <span className="border-b border-olive/30 pb-0.5 transition group-hover/cta:border-olive">
                        {tEquip("learnMore")}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`inline-block text-gold transition ${
                          reduceMotion
                            ? ""
                            : "group-hover/cta:translate-x-0.5"
                        }`}
                      >
                        →
                      </span>
                    </button>
                  </div>
                </motion.article>
              );
            })}
          </div>
        </div>

        <div className="mt-16 flex justify-center">
          <button
            type="button"
            onClick={() => onBook()}
            className="havenly-control inline-flex items-center bg-olive px-8 py-3.5 text-sm font-semibold text-white transition hover:bg-olive-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:text-base"
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
