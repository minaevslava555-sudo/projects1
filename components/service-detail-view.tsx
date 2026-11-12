"use client";

import HotspotGallery, {
  type TranslatedHotspotScene,
} from "@/components/hotspot-gallery";
import MassageCatalogView from "@/components/massage-catalog-view";
import type { MassageCategoryId } from "@/lib/massage-catalog";
import {
  SERVICE_HOTSPOTS,
  type HotspotService,
  type ServiceValue,
} from "@/lib/service-hotspots";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

export default function ServiceDetailView({
  service,
  onBack,
  onBook,
}: {
  service: ServiceValue;
  onBack: () => void;
  onBook: (massageCategoryId?: MassageCategoryId) => void;
}) {
  const t = useTranslations("ServiceDetail");
  const hotspotService: HotspotService =
    service === "massage" ? "cleaning" : service;
  const pack = SERVICE_HOTSPOTS[hotspotService];

  const scenes = useMemo<TranslatedHotspotScene[]>(
    () =>
      pack.scenes.map((scene) => ({
        id: scene.id,
        image: scene.image,
        label: t(`${hotspotService}.scenes.${scene.id}.label`),
        spots: scene.spots.map((spot) => ({
          id: spot.id,
          x: spot.x,
          y: spot.y,
          title: t(`${hotspotService}.scenes.${scene.id}.spots.${spot.id}.title`),
          text: t(`${hotspotService}.scenes.${scene.id}.spots.${spot.id}.text`),
        })),
      })),
    [pack.scenes, hotspotService, t],
  );

  if (service === "massage") {
    return (
      <MassageCatalogView
        onBack={onBack}
        onBook={(categoryId) => onBook(categoryId)}
      />
    );
  }

  const title = t(`${service}.title`);
  const subtitle = t(`${service}.subtitle`);

  return (
    <section className="relative overflow-hidden border-b border-mist bg-paper py-16 sm:py-20">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#e7ddce_0%,_transparent_55%),linear-gradient(180deg,_#f7f5f0_0%,_#e7ddce_100%)]" />
      <div className="relative mx-auto max-w-6xl px-5 sm:px-8 lg:px-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center border border-mist bg-white px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-olive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            {t("backToServices")}
          </button>
          <button
            type="button"
            onClick={() => onBook()}
            className="inline-flex items-center bg-olive px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-olive-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            {t("bookThisService")}
          </button>
        </div>

        <div className="mt-8 max-w-2xl">
          <p className="text-sm font-medium tracking-[0.18em] text-gold uppercase">
            {t("howWeWork")}
          </p>
          <h2 className="mt-2 font-display text-3xl font-medium tracking-tight sm:text-4xl">
            {title}
          </h2>
          <p className="mt-3 text-muted sm:text-lg">{subtitle}</p>
        </div>

        <div className="mt-10">
          <HotspotGallery scenes={scenes} />
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => onBook()}
            className="inline-flex items-center bg-olive px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-olive-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:text-base"
          >
            {t("bookService", { title })}
          </button>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center border border-mist bg-white px-6 py-3.5 text-sm font-semibold text-ink transition hover:border-olive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:text-base"
          >
            {t("chooseAnother")}
          </button>
        </div>
      </div>
    </section>
  );
}
