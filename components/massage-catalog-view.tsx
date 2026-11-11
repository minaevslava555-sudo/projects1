"use client";

import {
  MASSAGE_CATEGORIES,
  getMassageCategory,
  type MassageCategoryId,
} from "@/lib/massage-catalog";
import { useState } from "react";

const DURATION_HINTS = ["60 min — 45€", "90 min — 67.50€", "120 min — 90€"] as const;

export default function MassageCatalogView({
  onBack,
  onBook,
}: {
  onBack: () => void;
  onBook: (categoryId?: MassageCategoryId) => void;
}) {
  const [selectedId, setSelectedId] = useState<MassageCategoryId | null>(null);
  const selected = selectedId ? getMassageCategory(selectedId) : null;

  return (
    <section className="relative overflow-hidden border-b border-mist bg-paper py-16 sm:py-20">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#e7ddce_0%,_transparent_55%),linear-gradient(180deg,_#f7f5f0_0%,_#efe8dc_55%,_#e7ddce_100%)]" />
      <div className="relative mx-auto max-w-6xl px-5 sm:px-8 lg:px-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => {
              if (selected) {
                setSelectedId(null);
                return;
              }
              onBack();
            }}
            className="inline-flex items-center border border-mist bg-white px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-olive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            {selected ? "← All massage types" : "← Back to services"}
          </button>
          {!selected ? (
            <button
              type="button"
              onClick={() => onBook()}
              className="inline-flex items-center bg-olive px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-olive-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              Book Massage
            </button>
          ) : null}
        </div>

        {!selected ? (
          <>
            <div className="mt-10 max-w-2xl">
              <p className="text-xs font-medium tracking-[0.26em] text-gold uppercase">
                Premium In-Home Massage
              </p>
              <h2 className="mt-4 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl lg:text-[2.75rem]">
                Massage
              </h2>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-ink sm:text-lg">
                Professional massage, brought to the comfort of your home.
              </p>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
                Every session is delivered to your villa or apartment in the Algarve — choose the
                focus that suits your day.
              </p>
            </div>

            <div className="mt-12 grid gap-5 sm:grid-cols-2 sm:gap-6 lg:gap-7">
              {MASSAGE_CATEGORIES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className="group overflow-hidden border border-mist/70 bg-white/40 text-left shadow-[0_18px_40px_rgba(27,37,33,0.06)] transition duration-400 hover:-translate-y-0.5 hover:border-gold/45 hover:shadow-[0_22px_48px_rgba(27,37,33,0.1)]"
                >
                  <div className="relative aspect-[5/4] overflow-hidden sm:aspect-[4/3]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.image}
                      alt={item.imageAlt}
                      className="absolute inset-0 h-full w-full object-cover transition duration-[1.1s] ease-out group-hover:scale-[1.03]"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-ink/45 via-transparent to-transparent" />
                  </div>
                  <div className="px-5 py-5 sm:px-6 sm:py-6">
                    <h3 className="font-display text-2xl font-medium tracking-tight text-ink">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted sm:text-[0.95rem]">
                      {item.short}
                    </p>
                    <p className="mt-4 text-xs font-semibold tracking-[0.16em] text-olive uppercase">
                      View details
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="mt-10 grid items-start gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-14">
            <div className="relative aspect-[4/5] overflow-hidden sm:aspect-[5/6] lg:aspect-[4/5]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selected.image}
                alt={selected.imageAlt}
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink/40 via-transparent to-ink/10" />
            </div>

            <div>
              <p className="text-xs font-medium tracking-[0.26em] text-gold uppercase">
                Premium In-Home Massage
              </p>
              <h2 className="mt-4 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl lg:text-[2.65rem]">
                {selected.title}
              </h2>
              <p className="mt-3 text-sm font-medium text-olive sm:text-base">
                Professional massage, brought to the comfort of your home.
              </p>
              <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">
                {selected.description}
              </p>

              <ul className="mt-8 divide-y divide-mist/70 border-y border-mist/70">
                {selected.focus.map((line) => (
                  <li
                    key={line}
                    className="flex items-start gap-3.5 py-3.5 text-sm leading-relaxed text-ink sm:text-[0.95rem]"
                  >
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold"
                      aria-hidden="true"
                    />
                    {line}
                  </li>
                ))}
              </ul>

              <div className="mt-8">
                <p className="text-sm font-semibold tracking-wide text-olive">
                  Available durations
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {DURATION_HINTS.map((label) => (
                    <span
                      key={label}
                      className="border border-mist bg-white/80 px-3.5 py-2 text-sm text-ink"
                    >
                      {label}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-sm text-muted">
                  Choose your length in the booking form — same transparent rates as always.
                </p>
              </div>

              <div className="mt-10 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => onBook(selected.id)}
                  className="inline-flex items-center bg-olive px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-olive-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:text-base"
                >
                  Book Massage
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="inline-flex items-center border border-mist bg-white px-6 py-3.5 text-sm font-semibold text-ink transition hover:border-olive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:text-base"
                >
                  Browse other types
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
