"use client";

import "./havenly.css";

import BookingWizard from "@/components/booking-wizard";
import LanguageSwitcher from "@/components/language-switcher";
import ServiceDetailView from "@/components/service-detail-view";
import type { MassageCategoryId } from "@/lib/massage-catalog";
import type { ServiceValue } from "@/lib/service-hotspots";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

type CleaningRoomTab = "Kitchen" | "Rooms" | "Bathroom" | "Hallway";
type MassageFocusTab = "Back" | "Legs" | "Face";

/**
 * Brand landing media — files live in `public/images/`.
 * Drop future HAVENLY photography over the same filenames; no code change needed.
 */
const LANDING_MEDIA = {
  hero: "/images/hero.jpg",
  cleaning: "/images/service-cleaning.jpg",
  repair: "/images/service-repair.jpg",
  massage: "/images/service-massage.jpg",
} as const;

const NAV_HREFS = [
  { href: "#top", key: "home" as const },
  { href: "#services", key: "services" as const },
  { href: "#included", key: "howItWorks" as const },
  { href: "#area", key: "area" as const },
  { href: "#faq", key: "faq" as const },
] as const;

function Reveal({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`reveal ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}

export default function Home() {
  const t = useTranslations();
  const [modalOpen, setModalOpen] = useState(false);
  const [bookingSession, setBookingSession] = useState(0);
  const [service, setService] = useState<ServiceValue>("cleaning");
  const [activeServiceView, setActiveServiceView] = useState<ServiceValue | null>(null);
  const [lockService, setLockService] = useState(false);
  const [massageCategoryId, setMassageCategoryId] = useState<MassageCategoryId | null>(
    null,
  );
  const [includedService, setIncludedService] = useState<ServiceValue>("cleaning");
  const [cleaningTab, setCleaningTab] = useState<CleaningRoomTab>("Kitchen");
  const [massageTab, setMassageTab] = useState<MassageFocusTab>("Back");
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [navOpen, setNavOpen] = useState(false);

  const serviceMeta = useMemo(
    () =>
      ({
        cleaning: {
          title: t("Services.cleaning.title"),
          rateLabel: t("Services.cleaning.rateLabel"),
          cardPrice: t("Services.cleaning.cardPrice"),
        },
        repair: {
          title: t("Services.repair.title"),
          rateLabel: t("Services.repair.rateLabel"),
          cardPrice: t("Services.repair.cardPrice"),
        },
        massage: {
          title: t("Services.massage.title"),
          rateLabel: t("Services.massage.rateLabel"),
          cardPrice: t("Services.massage.cardPrice"),
        },
      }) as const,
    [t],
  );

  const heroServices = useMemo(
    () =>
      [
        {
          id: "cleaning" as const,
          title: t("Services.cleaning.title"),
          blurb: t("Services.cleaning.blurb"),
          image: LANDING_MEDIA.cleaning,
          price: t("Services.cleaning.cardPrice"),
          imageAlt: t("Services.cleaning.imageAlt"),
        },
        {
          id: "repair" as const,
          title: t("Services.repair.title"),
          blurb: t("Services.repair.blurb"),
          image: LANDING_MEDIA.repair,
          price: t("Services.repair.cardPrice"),
          imageAlt: t("Services.repair.imageAlt"),
        },
        {
          id: "massage" as const,
          title: t("Services.massage.title"),
          blurb: t("Services.massage.blurb"),
          image: LANDING_MEDIA.massage,
          price: t("Services.massage.cardPrice"),
          imageAlt: t("Services.massage.imageAlt"),
        },
      ] as const,
    [t],
  );

  const cleaningChecklists = useMemo(
    () =>
      ({
        Kitchen: t.raw("Included.cleaningKitchen") as string[],
        Rooms: t.raw("Included.cleaningRooms") as string[],
        Bathroom: t.raw("Included.cleaningBathroom") as string[],
        Hallway: t.raw("Included.cleaningHallway") as string[],
      }) as const,
    [t],
  );

  const massageChecklists = useMemo(
    () =>
      ({
        Back: t.raw("Included.massageBack") as string[],
        Legs: t.raw("Included.massageLegs") as string[],
        Face: t.raw("Included.massageFace") as string[],
      }) as const,
    [t],
  );

  const repairChecklist = useMemo(
    () => t.raw("Included.repairItems") as string[],
    [t],
  );

  const faqItems = useMemo(
    () =>
      t.raw("Faq.items") as Array<{ question: string; answer: string }>,
    [t],
  );

  // Лендинг не использует dark-тему агента из localStorage (globals.css иначе перебивает CTA/ссылки).
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-theme");
    root.setAttribute("data-theme", "light");
    return () => {
      if (previous) root.setAttribute("data-theme", previous);
      else root.removeAttribute("data-theme");
    };
  }, []);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  function openServiceView(value: ServiceValue) {
    setNavOpen(false);
    setService(value);
    setActiveServiceView(value);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openOrder(
    value: ServiceValue,
    locked = false,
    categoryId: MassageCategoryId | null = null,
  ) {
    setService(value);
    setLockService(locked);
    setMassageCategoryId(value === "massage" ? categoryId : null);
    setBookingSession((n) => n + 1);
    setModalOpen(true);
  }

  function goHome() {
    setNavOpen(false);
    setActiveServiceView(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function onNavClick(href: string) {
    setNavOpen(false);
    setActiveServiceView(null);
    if (href === "#top") {
      window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
      return;
    }
    window.setTimeout(() => {
      document.querySelector(href)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  const headerOnHero = !activeServiceView;

  return (
    <div className="havenly-landing min-h-svh bg-paper font-sans text-ink antialiased">
      <header
        className={`z-30 ${
          headerOnHero
            ? "absolute inset-x-0 top-0"
            : "relative border-b border-mist bg-olive-deep"
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8 lg:px-10">
          <button
            type="button"
            onClick={goHome}
            className="font-display text-xl font-medium tracking-[0.18em] text-white sm:text-2xl"
            aria-label={t("Nav.homeAria")}
          >
            HAVENLY
          </button>

          <nav className="hidden items-center gap-7 lg:flex" aria-label={t("Nav.primary")}>
            {NAV_HREFS.map((link) => (
              <button
                key={link.href}
                type="button"
                onClick={() => onNavClick(link.href)}
                className="text-sm font-medium text-white/85 transition hover:text-white"
              >
                {t(`Nav.${link.key}`)}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <LanguageSwitcher className="shrink-0" tone="onDark" />
            <a
              href="tel:+351920024478"
              className="hidden text-sm font-semibold text-white/90 transition hover:text-white md:inline"
            >
              +351 920 024 478
            </a>
            <button
              type="button"
              onClick={() => openOrder("cleaning", true)}
              className="hidden border border-white/35 bg-white/10 px-3.5 py-2 text-sm font-semibold text-white backdrop-blur-sm transition hover:border-gold/60 hover:bg-white/15 lg:inline-flex"
            >
              {t("Nav.book")}
            </button>
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center border border-white/30 text-white lg:hidden"
              aria-expanded={navOpen}
              aria-controls="mobile-nav"
              aria-label={navOpen ? t("Nav.closeMenu") : t("Nav.openMenu")}
              onClick={() => setNavOpen((open) => !open)}
            >
              <span className="font-display text-lg leading-none">{navOpen ? "×" : "☰"}</span>
            </button>
          </div>
        </div>

        {navOpen ? (
          <div
            id="mobile-nav"
            className="border-t border-white/15 bg-olive-deep/95 px-5 py-5 backdrop-blur-md lg:hidden"
          >
            <nav className="mx-auto flex max-w-6xl flex-col gap-1" aria-label={t("Nav.mobile")}>
              {NAV_HREFS.map((link) => (
                <button
                  key={link.href}
                  type="button"
                  onClick={() => onNavClick(link.href)}
                  className="rounded-lg px-3 py-3 text-left text-base font-medium text-white/90 transition hover:bg-white/10 hover:text-white"
                >
                  {t(`Nav.${link.key}`)}
                </button>
              ))}
              <div className="mt-2 px-3 py-2">
                <LanguageSwitcher tone="onDark" />
              </div>
              <a
                href="tel:+351920024478"
                className="mt-2 rounded-lg px-3 py-3 text-base font-semibold text-gold"
              >
                +351 920 024 478
              </a>
              <button
                type="button"
                onClick={() => {
                  setNavOpen(false);
                  openOrder("cleaning", true);
                }}
                className="mt-1 rounded-lg bg-olive px-3 py-3 text-left text-base font-semibold text-white"
              >
                {t("Nav.bookCleaning")}
              </button>
            </nav>
          </div>
        ) : null}
      </header>

      <main id="top">
        {activeServiceView ? (
          <ServiceDetailView
            service={activeServiceView}
            onBack={() => setActiveServiceView(null)}
            onBook={(categoryId) => openOrder(activeServiceView, true, categoryId ?? null)}
          />
        ) : (
          <>
            <section className="relative min-h-[100svh] overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={LANDING_MEDIA.hero}
                alt={t("Hero.heroAlt")}
                className="animate-hero-media absolute inset-0 h-full w-full object-cover object-[58%_center] sm:object-center"
              />
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(43,32,18,0.28)_0%,rgba(27,37,33,0.35)_42%,rgba(27,37,33,0.88)_100%)]" />
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_80%,rgba(181,154,107,0.22)_0%,transparent_55%)]" />

              <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-6xl flex-col justify-end px-5 pb-7 pt-28 sm:px-8 sm:pb-12 lg:px-10 lg:pb-16">
                <div className="animate-rise max-w-3xl">
                  <p className="text-[0.7rem] font-medium tracking-[0.28em] text-sand/90 uppercase sm:text-xs">
                    {t("Hero.eyebrow")}
                  </p>
                  <h1 className="mt-4 max-w-[14ch] font-display text-[2.35rem] font-medium leading-[1.08] tracking-[-0.01em] text-white sm:mt-5 sm:max-w-[16ch] sm:text-5xl lg:text-[3.55rem] lg:leading-[1.05]">
                    {t("Hero.title")}
                  </h1>
                  <p className="mt-4 max-w-md text-[0.98rem] leading-relaxed text-white/82 sm:mt-5 sm:text-lg lg:max-w-lg">
                    <span className="lg:hidden">{t("Hero.subtitleMobile")}</span>
                    <span className="hidden lg:inline">{t("Hero.subtitleDesktop")}</span>
                  </p>
                </div>

                <div
                  id="services"
                  className="animate-rise-late mt-10 hidden grid-cols-3 gap-5 lg:mt-14 lg:grid"
                >
                  {heroServices.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openServiceView(item.id)}
                      className="group relative aspect-[4/5] overflow-hidden text-left shadow-[0_24px_48px_rgba(27,37,33,0.28)] transition duration-500 hover:-translate-y-1"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.image}
                        alt={item.imageAlt}
                        className="absolute inset-0 h-full w-full object-cover transition duration-[1.1s] ease-out group-hover:scale-[1.04]"
                      />
                      <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_35%,rgba(27,37,33,0.55)_68%,rgba(27,37,33,0.92)_100%)]" />
                      <div className="relative flex h-full flex-col justify-end p-6">
                        <p className="font-display text-[1.65rem] font-medium leading-tight text-white">
                          {item.title}
                        </p>
                        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-white/78">
                          {item.blurb}
                        </p>
                        <p className="mt-4 text-xs font-semibold tracking-[0.16em] text-gold uppercase">
                          {item.price}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>

                <div
                  className="animate-rise-late hero-service-rail -mx-5 mt-9 flex snap-x snap-mandatory gap-3.5 overflow-x-auto px-5 pb-2 sm:-mx-8 sm:gap-4 sm:px-8 lg:hidden"
                  aria-label={t("Hero.servicesAria")}
                >
                  {heroServices.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openServiceView(item.id)}
                      className="group relative h-[17rem] w-[78vw] max-w-[20rem] shrink-0 snap-center overflow-hidden text-left shadow-[0_18px_40px_rgba(27,37,33,0.35)] sm:w-[17.5rem]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.image}
                        alt={item.imageAlt}
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_30%,rgba(27,37,33,0.5)_62%,rgba(27,37,33,0.92)_100%)]" />
                      <div className="relative flex h-full flex-col justify-end p-5">
                        <p className="font-display text-2xl font-medium text-white">{item.title}</p>
                        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-white/78">
                          {item.blurb}
                        </p>
                        <p className="mt-3.5 text-xs font-semibold tracking-[0.16em] text-gold uppercase">
                          {item.price}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="relative overflow-hidden border-b border-mist py-16 sm:py-20">
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,_#f7f5f0_0%,_#e7ddce_100%)]" />
              <div className="relative mx-auto max-w-6xl px-5 sm:px-8 lg:px-10">
                <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
                  <Reveal>
                    <h2 className="font-display text-xl font-medium text-olive sm:text-2xl">
                      {t("Trust.verifiedTitle")}
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
                      {t("Trust.verifiedBody")}
                    </p>
                  </Reveal>
                  <Reveal style={{ transitionDelay: "60ms" }}>
                    <h2 className="font-display text-xl font-medium text-olive sm:text-2xl">
                      {t("Trust.englishTitle")}
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
                      {t("Trust.englishBody")}
                    </p>
                  </Reveal>
                  <Reveal style={{ transitionDelay: "120ms" }}>
                    <h2 className="font-display text-xl font-medium text-olive sm:text-2xl">
                      {t("Trust.pricingTitle")}
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
                      {t("Trust.pricingBody")}
                    </p>
                  </Reveal>
                  <Reveal style={{ transitionDelay: "180ms" }}>
                    <h2 className="font-display text-xl font-medium text-olive sm:text-2xl">
                      {t("Trust.secureTitle")}
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
                      {t("Trust.secureBody")}
                    </p>
                  </Reveal>
                </div>
              </div>
            </section>

            <section id="included" className="relative overflow-hidden border-t border-mist py-20 sm:py-28">
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(165deg,_#f7f5f0_0%,_#efe8dc_48%,_#e7ddce_100%)]" />
              <div className="relative mx-auto max-w-6xl px-5 sm:px-8 lg:px-10">
                <Reveal className="max-w-2xl">
                  <p className="text-xs font-medium tracking-[0.26em] text-gold uppercase">
                    {t("Included.eyebrow")}
                  </p>
                  <h2 className="mt-4 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl lg:text-[2.75rem]">
                    {t("Included.title")}
                  </h2>
                  <p className="mt-4 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
                    {t("Included.subtitle")}
                  </p>
                </Reveal>

                <div className="mt-12 grid items-start gap-10 lg:mt-14 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-14">
                  <Reveal className="relative overflow-hidden">
                    <div className="relative aspect-[4/5] overflow-hidden sm:aspect-[5/6] lg:aspect-[4/5]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        key={includedService}
                        src={LANDING_MEDIA[includedService]}
                        alt={
                          heroServices.find((s) => s.id === includedService)?.imageAlt ??
                          serviceMeta[includedService].title
                        }
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-ink/50 via-transparent to-ink/10" />
                      <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
                        <p className="font-display text-2xl font-medium text-white sm:text-3xl">
                          {serviceMeta[includedService].title}
                        </p>
                        <p className="mt-1 text-sm text-white/75">
                          {serviceMeta[includedService].rateLabel}
                        </p>
                      </div>
                    </div>
                  </Reveal>

                  <div>
                    <div className="flex flex-wrap gap-2 border-b border-mist/80 pb-5">
                      {(Object.keys(serviceMeta) as ServiceValue[]).map((value) => {
                        const active = includedService === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setIncludedService(value)}
                            className={`px-4 py-2.5 text-sm font-semibold tracking-wide transition ${
                              active
                                ? "bg-olive text-white"
                                : "border border-mist bg-white/70 text-ink hover:border-olive/40"
                            }`}
                          >
                            {serviceMeta[value].title}
                          </button>
                        );
                      })}
                    </div>

                    {includedService === "cleaning" ? (
                      <div className="mt-6">
                        <div className="flex flex-wrap gap-2">
                          {(Object.keys(cleaningChecklists) as CleaningRoomTab[]).map((tab) => {
                            const active = cleaningTab === tab;
                            return (
                              <button
                                key={tab}
                                type="button"
                                onClick={() => setCleaningTab(tab)}
                                className={`px-3.5 py-2 text-sm font-medium transition ${
                                  active
                                    ? "bg-olive text-white"
                                    : "text-muted underline-offset-4 hover:text-ink hover:underline"
                                }`}
                              >
                                {t(`Included.cleaningTabs.${tab}`)}
                              </button>
                            );
                          })}
                        </div>
                        <ul className="mt-6 divide-y divide-mist/70 border-t border-mist/70">
                          {cleaningChecklists[cleaningTab].map((item) => (
                            <li
                              key={item}
                              className="flex items-start gap-3.5 py-3.5 text-sm leading-relaxed text-ink sm:text-[0.95rem]"
                            >
                              <span
                                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold"
                                aria-hidden="true"
                              />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {includedService === "massage" ? (
                      <div className="mt-6">
                        <div className="flex flex-wrap gap-2">
                          {(Object.keys(massageChecklists) as MassageFocusTab[]).map((tab) => {
                            const active = massageTab === tab;
                            return (
                              <button
                                key={tab}
                                type="button"
                                onClick={() => setMassageTab(tab)}
                                className={`px-3.5 py-2 text-sm font-medium transition ${
                                  active
                                    ? "bg-olive text-white"
                                    : "text-muted underline-offset-4 hover:text-ink hover:underline"
                                }`}
                              >
                                {t(`Included.massageTabs.${tab}`)}
                              </button>
                            );
                          })}
                        </div>
                        <ul className="mt-6 divide-y divide-mist/70 border-t border-mist/70">
                          {massageChecklists[massageTab].map((item) => (
                            <li
                              key={item}
                              className="flex items-start gap-3.5 py-3.5 text-sm leading-relaxed text-ink sm:text-[0.95rem]"
                            >
                              <span
                                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold"
                                aria-hidden="true"
                              />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {includedService === "repair" ? (
                      <div className="mt-6">
                        <p className="text-sm font-semibold tracking-wide text-olive">
                          {t("Included.handymanTitle")}
                        </p>
                        <ul className="mt-4 divide-y divide-mist/70 border-t border-mist/70">
                          {repairChecklist.map((item) => (
                            <li
                              key={item}
                              className="flex items-start gap-3.5 py-3.5 text-sm leading-relaxed text-ink sm:text-[0.95rem]"
                            >
                              <span
                                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold"
                                aria-hidden="true"
                              />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => openServiceView(includedService)}
                      className="mt-8 inline-flex items-center bg-olive px-5 py-3 text-sm font-semibold text-white transition hover:bg-olive-deep"
                    >
                      {t("Included.explore", {
                        service: serviceMeta[includedService].title,
                      })}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section id="area" className="relative overflow-hidden border-y border-mist py-20 sm:py-24">
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,_#e7ddce_0%,_#f7f5f0_50%,_#e7ddce_100%)]" />
              <div className="relative mx-auto max-w-6xl px-5 sm:px-8 lg:px-10">
                <Reveal className="max-w-3xl">
                  <p className="text-sm font-medium tracking-[0.22em] text-gold uppercase">
                    {t("Area.eyebrow")}
                  </p>
                  <h2 className="mt-3 font-display text-3xl font-medium tracking-tight sm:text-4xl lg:text-[2.75rem]">
                    {t("Area.title")}
                  </h2>
                  <p className="mt-5 text-lg leading-relaxed text-ink sm:text-xl">
                    {t("Area.cities")}
                  </p>
                  <p className="mt-4 max-w-xl text-muted">{t("Area.note")}</p>
                </Reveal>
              </div>
            </section>

            <section className="relative overflow-hidden py-20 sm:py-24">
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,_#e7ddce_0%,_#f7f5f0_48%,_#e7ddce_100%)]" />
              <div className="relative mx-auto max-w-6xl px-5 text-center sm:px-8 lg:px-10">
                <Reveal>
                  <h2 className="font-display text-3xl font-medium tracking-tight sm:text-4xl lg:text-[2.75rem]">
                    {t("Cta.title")}
                  </h2>
                  <p className="mx-auto mt-3 max-w-md text-muted sm:text-lg">
                    {t("Cta.subtitle")}
                  </p>
                  <button
                    type="button"
                    onClick={() => openServiceView("cleaning")}
                    className="mt-8 inline-flex items-center bg-olive px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-olive-deep sm:text-base"
                  >
                    {t("Cta.bookCleaning")}
                  </button>
                  <p className="mt-6 text-sm text-muted">
                    {t("Cta.orCall")}{" "}
                    <a
                      href="tel:+351920024478"
                      className="font-medium text-olive underline-offset-4 hover:underline"
                    >
                      +351 920 024 478
                    </a>
                  </p>
                </Reveal>
              </div>
            </section>

            <section id="faq" className="relative overflow-hidden border-t border-mist py-20 sm:py-24">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#e7ddce_0%,_transparent_50%),linear-gradient(180deg,_#f7f5f0_0%,_#e7ddce_100%)]" />
              <div className="relative mx-auto max-w-6xl px-5 sm:px-8 lg:px-10">
                <Reveal className="max-w-3xl">
                  <p className="text-sm font-medium tracking-[0.22em] text-gold uppercase">
                    {t("Faq.eyebrow")}
                  </p>
                  <h2 className="mt-3 font-display text-3xl font-medium tracking-tight sm:text-4xl lg:text-[2.75rem]">
                    {t("Faq.title")}
                  </h2>
                  <p className="mt-3 text-muted sm:text-lg">{t("Faq.subtitle")}</p>
                  <div className="mt-8 divide-y divide-mist overflow-hidden rounded-2xl border border-mist bg-white/90">
                    {faqItems.map((item, index) => {
                      const open = openFaq === index;
                      return (
                        <div key={item.question}>
                          <button
                            type="button"
                            aria-expanded={open}
                            onClick={() => setOpenFaq(open ? null : index)}
                            className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-sand/50 sm:px-6"
                          >
                            <span className="font-medium text-ink sm:text-lg">{item.question}</span>
                            <span
                              className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sand text-olive transition ${
                                open ? "rotate-45" : ""
                              }`}
                              aria-hidden="true"
                            >
                              +
                            </span>
                          </button>
                          {open ? (
                            <p className="px-5 pb-5 text-sm leading-relaxed text-muted sm:px-6 sm:text-base">
                              {item.answer}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </Reveal>
              </div>
            </section>
          </>
        )}
      </main>

      <footer className="border-t border-mist bg-olive-deep py-12 text-paper/75">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 sm:grid-cols-3 sm:px-8 lg:px-10">
          <div>
            <p className="font-display text-2xl font-medium tracking-[0.16em] text-white">
              HAVENLY
            </p>
            <p className="mt-2 text-sm tracking-[0.08em] text-sand/80">{t("Footer.tagline")}</p>
            <p className="mt-4 text-sm text-sand/60">{t("Footer.copyright")}</p>
          </div>

          <div>
            <p className="text-sm font-semibold tracking-[0.14em] text-white uppercase">
              {t("Footer.quickLinks")}
            </p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li>
                <button
                  type="button"
                  onClick={() => openServiceView("cleaning")}
                  className="transition hover:text-white"
                >
                  {t("Footer.cleaning")}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => openServiceView("repair")}
                  className="transition hover:text-white"
                >
                  {t("Footer.repairs")}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => openServiceView("massage")}
                  className="transition hover:text-white"
                >
                  {t("Footer.massage")}
                </button>
              </li>
              <li>
                <a
                  href="#faq"
                  className="transition hover:text-white"
                  onClick={() => setActiveServiceView(null)}
                >
                  {t("Footer.faq")}
                </a>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-sm font-semibold tracking-[0.14em] text-white uppercase">
              {t("Footer.coverage")}
            </p>
            <p className="mt-4 text-sm leading-relaxed text-sand/80">{t("Footer.cities")}</p>
            <a
              href="tel:+351920024478"
              className="mt-5 inline-flex text-lg font-semibold text-white transition hover:text-sand"
            >
              +351 920 024 478
            </a>
          </div>
        </div>
      </footer>

      {modalOpen ? (
        <BookingWizard
          key={bookingSession}
          open={modalOpen}
          service={service}
          onServiceChange={(next) => {
            setService(next);
            if (next !== "massage") setMassageCategoryId(null);
          }}
          onClose={() => {
            setModalOpen(false);
            setMassageCategoryId(null);
          }}
          lockService={lockService}
          massageCategoryId={massageCategoryId}
        />
      ) : null}
    </div>
  );
}
