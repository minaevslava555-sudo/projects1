"use client";

import HotspotGallery from "@/components/hotspot-gallery";
import MassageCatalogView from "@/components/massage-catalog-view";
import { SERVICE_HOTSPOTS, type ServiceValue } from "@/lib/service-hotspots";

export default function ServiceDetailView({
  service,
  onBack,
  onBook,
}: {
  service: ServiceValue;
  onBack: () => void;
  onBook: (massageStyle?: string) => void;
}) {
  if (service === "massage") {
    return (
      <MassageCatalogView
        onBack={onBack}
        onBook={(categoryTitle) => onBook(categoryTitle)}
      />
    );
  }

  const pack = SERVICE_HOTSPOTS[service];

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
            ← Back to services
          </button>
          <button
            type="button"
            onClick={() => onBook()}
            className="inline-flex items-center bg-olive px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-olive-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            Book this service
          </button>
        </div>

        <div className="mt-8 max-w-2xl">
          <p className="text-sm font-medium tracking-[0.18em] text-gold uppercase">
            How we work
          </p>
          <h2 className="mt-2 font-display text-3xl font-medium tracking-tight sm:text-4xl">
            {pack.title}
          </h2>
          <p className="mt-3 text-muted sm:text-lg">{pack.subtitle}</p>
        </div>

        <div className="mt-10">
          <HotspotGallery scenes={pack.scenes} />
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => onBook()}
            className="inline-flex items-center bg-olive px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-olive-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:text-base"
          >
            Book {pack.title}
          </button>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center border border-mist bg-white px-6 py-3.5 text-sm font-semibold text-ink transition hover:border-olive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:text-base"
          >
            Choose another service
          </button>
        </div>
      </div>
    </section>
  );
}
