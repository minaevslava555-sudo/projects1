"use client";

import "./havenly.css";

import ServiceDetailView from "@/components/service-detail-view";
import type { ServiceValue } from "@/lib/service-hotspots";
import {
  FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

type MassageMinutes = 60 | 90 | 120;

const SERVICE_META: Record<
  ServiceValue,
  { title: string; rateLabel: string; cardPrice: string }
> = {
  cleaning: {
    title: "Cleaning",
    rateLabel: "20€ / hour per cleaner",
    cardPrice: "from 20€",
  },
  repair: {
    title: "Home Repairs",
    rateLabel: "20€ / hour per technician",
    cardPrice: "from 20€",
  },
  massage: {
    title: "Massage",
    rateLabel: "45€ / hour",
    cardPrice: "from 45€",
  },
};

const MASSAGE_OPTIONS: Array<{ minutes: MassageMinutes; price: number; label: string }> = [
  { minutes: 60, price: 45, label: "60 min — 45€" },
  { minutes: 90, price: 67.5, label: "90 min — 67.50€" },
  { minutes: 120, price: 90, label: "120 min — 90€" },
];

function cleaningPlan(rooms: number): { hours: number; workers: number } {
  switch (Math.min(6, Math.max(1, rooms))) {
    case 1:
      return { hours: 2, workers: 1 };
    case 2:
      return { hours: 3, workers: 1 };
    case 3:
      return { hours: 4, workers: 2 };
    case 4:
      return { hours: 5, workers: 2 };
    case 5:
    case 6:
    default:
      return { hours: 6, workers: 3 };
  }
}

type CleaningRoomTab = "Kitchen" | "Rooms" | "Bathroom" | "Hallway";
type MassageFocusTab = "Back" | "Legs" | "Face";

const CLEANING_CHECKLISTS: Record<CleaningRoomTab, string[]> = {
  Kitchen: [
    "Wash dishes and load/unload dishwasher",
    "Clean stovetop and hob",
    "Wipe countertops and cabinet fronts",
    "Empty trash and tidy surfaces",
  ],
  Rooms: [
    "Dust furniture and accessible shelves",
    "Make beds and straighten bedding",
    "Vacuum under and around furniture",
    "Wipe switches, handles and mirrors",
  ],
  Bathroom: [
    "Sanitize toilet and seat",
    "Scrub tub, shower and tiles",
    "Polish mirrors and chrome fittings",
    "Mop floor and restock basics if provided",
  ],
  Hallway: [
    "Vacuum and mop entry floors",
    "Dust console tables and frames",
    "Wipe door handles and light switches",
    "Tidy shoes and coat area",
  ],
};

const MASSAGE_CHECKLISTS: Record<MassageFocusTab, string[]> = {
  Back: [
    "Full-back tension release",
    "Shoulder and neck focus",
    "Posture-friendly pressure",
    "Deep relaxation finish",
  ],
  Legs: [
    "Thigh and calf massage",
    "Circulation-friendly strokes",
    "Sport recovery support",
    "Gentle stretch cues",
  ],
  Face: [
    "Soft facial massage",
    "Temple and jaw ease",
    "Lymphatic-style light work",
    "Calming close of session",
  ],
};

const REPAIR_CHECKLIST = [
  "Furniture assembly and shelf mounting",
  "Minor plumbing adjustments",
  "Socket and switch replacements",
  "Door hinge, handle and lock fixes",
  "Light fixture installation",
];

const FAQ_ITEMS = [
  {
    question: "What if something gets damaged or missing?",
    answer:
      "We fully vet our local specialists and carry comprehensive insurance coverage.",
  },
  {
    question: "Do I need to provide cleaning supplies?",
    answer:
      "No, our professionals bring high-quality eco-friendly products and standard equipment.",
  },
  {
    question: "How do I pay for the service?",
    answer:
      "Pay securely after the job is completed and inspected — via Cash, Card, or Revolut.",
  },
  {
    question: "Can I book a recurring plan?",
    answer:
      "Yes, we offer regular subscription plans that save you up to 20% on home care.",
  },
] as const;

/**
 * Brand landing media — files live in `public/images/`.
 * Drop future HAVENLY photography over the same filenames; no code change needed.
 *
 * Current stand-ins (commercial-safe stock, not HAVENLY staff):
 * - hero.jpg — Unsplash License (modern villa + pool)
 * - service-cleaning.jpg — Pexels License
 * - service-repair.jpg — Pexels License
 * - service-massage.jpg — Pexels License
 */
const LANDING_MEDIA = {
  hero: "/images/hero.jpg",
  cleaning: "/images/service-cleaning.jpg",
  repair: "/images/service-repair.jpg",
  massage: "/images/service-massage.jpg",
} as const;

const NAV_LINKS = [
  { href: "#top", label: "Home" },
  { href: "#services", label: "Services" },
  { href: "#included", label: "How It Works" },
  { href: "#area", label: "Area" },
  { href: "#faq", label: "FAQ" },
] as const;

const HERO_SERVICES: Array<{
  id: ServiceValue;
  title: string;
  blurb: string;
  image: string;
  price: string;
  imageAlt: string;
}> = [
  {
    id: "cleaning",
    title: "Cleaning",
    blurb: "Immaculate villas and apartments, prepared with quiet precision.",
    image: LANDING_MEDIA.cleaning,
    price: SERVICE_META.cleaning.cardPrice,
    imageAlt: "Professional cleaning detail in a bright luxury bathroom",
  },
  {
    id: "repair",
    title: "Home Repairs",
    blurb: "Discreet handyman care for everyday comfort at home.",
    image: LANDING_MEDIA.repair,
    price: SERVICE_META.repair.cardPrice,
    imageAlt: "Careful finishing work on a clean modern interior wall",
  },
  {
    id: "massage",
    title: "Massage",
    blurb: "Professional massage, brought to the comfort of your home.",
    image: LANDING_MEDIA.massage,
    price: SERVICE_META.massage.cardPrice,
    imageAlt: "In-home massage in a bright residential interior",
  },
];

function formatEuro(value: number) {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

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

function Stepper({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-ink">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center border border-mist bg-paper text-lg font-semibold text-ink transition hover:border-olive disabled:opacity-40"
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          −
        </button>
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (!Number.isFinite(next)) return;
            onChange(Math.min(max, Math.max(min, Math.round(next))));
          }}
          className="w-full border border-mist bg-paper px-4 py-3 text-center text-ink outline-none transition focus:border-olive"
        />
        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center border border-mist bg-paper text-lg font-semibold text-ink transition hover:border-olive disabled:opacity-40"
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          +
        </button>
      </div>
    </div>
  );
}

function OrderModal({
  open,
  service,
  onServiceChange,
  onClose,
  lockService = false,
  massageStyle = "",
}: {
  open: boolean;
  service: ServiceValue;
  onServiceChange: (service: ServiceValue) => void;
  onClose: () => void;
  lockService?: boolean;
  /** Optional massage menu label — stored in free-text `details`, not a DB column. */
  massageStyle?: string;
}) {
  const titleId = useId();
  const [rooms, setRooms] = useState(2);
  const [hours, setHours] = useState(2);
  const [workers, setWorkers] = useState(1);
  const [massageMinutes, setMassageMinutes] = useState<MassageMinutes>(60);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState("");
  const [success, setSuccess] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const cleaning = useMemo(() => cleaningPlan(rooms), [rooms]);
  const cleaningHours = cleaning.hours;
  const cleaningWorkers = cleaning.workers;

  useEffect(() => {
    if (!open) return;
    setRooms(2);
    setHours(2);
    setWorkers(1);
    setMassageMinutes(60);
    setName("");
    setPhone("");
    setDate("");
    setSuccess(false);
    setSending(false);
    setError("");
  }, [open, service]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  const total = useMemo(() => {
    if (service === "massage") {
      return MASSAGE_OPTIONS.find((option) => option.minutes === massageMinutes)?.price ?? 45;
    }
    if (service === "cleaning") {
      return cleaningHours * cleaningWorkers * 20;
    }
    return hours * workers * 20;
  }, [service, hours, workers, massageMinutes, cleaningHours, cleaningWorkers]);

  function orderDetails() {
    if (service === "massage") {
      const duration = `${massageMinutes} min session`;
      const style = massageStyle.trim();
      return style ? `${style} · ${duration}` : duration;
    }
    if (service === "cleaning") {
      return `${rooms} room(s) require ~${cleaningHours} hours and ${cleaningWorkers} cleaner(s)`;
    }
    return `${hours} h × ${workers} technician${workers > 1 ? "s" : ""} × 20€`;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (sending) return;

    setSending(true);
    setError("");
    setSuccess(false);

    try {
      const response = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          service,
          priceEuro: total,
          date,
          details: orderDetails(),
          rooms: service === "cleaning" ? rooms : undefined,
          hours:
            service === "massage"
              ? undefined
              : service === "cleaning"
                ? cleaningHours
                : hours,
          workers:
            service === "massage"
              ? undefined
              : service === "cleaning"
                ? cleaningWorkers
                : workers,
          massageMinutes: service === "massage" ? massageMinutes : undefined,
        }),
      });

      const contentType = response.headers.get("content-type") || "";
      const rawText = await response.text();
      let data: { error?: string; ok?: boolean; id?: string; telegramOk?: boolean } = {};
      if (contentType.includes("application/json")) {
        try {
          data = JSON.parse(rawText) as {
            error?: string;
            ok?: boolean;
            id?: string;
            telegramOk?: boolean;
          };
        } catch {
          throw new Error("Сервер вернул некорректный JSON");
        }
      } else if (rawText.trim()) {
        throw new Error(
          response.ok
            ? "Сервер вернул не JSON"
            : `Ошибка сервера (${response.status}). Проверьте деплой API на Vercel.`,
        );
      } else {
        throw new Error(`Пустой ответ сервера (${response.status})`);
      }

      if (!response.ok || !data.ok || !data.id) {
        throw new Error(data.error || "Не удалось сохранить заказ");
      }
      setSuccess(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Не удалось отправить заказ");
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  const meta = SERVICE_META[service];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/55 p-0 sm:items-center sm:p-6"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[92svh] w-full max-w-lg overflow-y-auto border border-mist bg-paper shadow-2xl sm:max-h-[90svh]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-mist bg-paper/95 px-5 py-4 backdrop-blur sm:px-6">
          <div>
            <p className="text-xs font-medium tracking-[0.18em] text-gold uppercase">
              Booking calculator
            </p>
            <h2 id={titleId} className="mt-1 font-display text-2xl font-medium text-ink">
              {meta.title}
            </h2>
            {service === "massage" && massageStyle.trim() ? (
              <p className="mt-1 text-sm font-medium text-olive">{massageStyle.trim()}</p>
            ) : null}
            <p className="mt-1 text-sm text-muted">{meta.rateLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center border border-mist bg-white text-ink transition hover:border-olive"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form className="space-y-6 px-5 py-5 sm:px-6 sm:py-6" noValidate onSubmit={onSubmit}>
          {!lockService ? (
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(SERVICE_META) as ServiceValue[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onServiceChange(value)}
                  className={`rounded-lg px-2 py-2.5 text-xs font-semibold transition sm:text-sm ${
                    service === value
                      ? "bg-olive text-white shadow-sm shadow-olive/25"
                      : "border border-mist bg-white text-ink hover:border-olive/50"
                  }`}
                >
                  {SERVICE_META[value].title}
                </button>
              ))}
            </div>
          ) : null}

          <div className="rounded-xl border border-mist bg-white px-5 py-6 text-center">
            <p className="text-xs font-medium tracking-[0.18em] text-muted uppercase">Total</p>
            <p className="mt-2 font-display text-5xl font-bold tracking-tight text-olive sm:text-6xl">
              {formatEuro(total)}
            </p>
          </div>

          {service === "cleaning" ? (
            <div className="space-y-4">
              <Stepper
                id="cleaning-rooms"
                label="Number of rooms"
                value={rooms}
                min={1}
                max={6}
                onChange={setRooms}
              />
              <div className="rounded-xl border border-sand bg-sand/70 px-4 py-3 text-sm leading-relaxed text-ink">
                <p className="font-medium">
                  {rooms} room(s) require ~{cleaningHours} hours and {cleaningWorkers}{" "}
                  cleaner(s)
                </p>
                <p className="mt-1 text-olive/80">
                  {cleaningHours} × {cleaningWorkers} × 20€ = {formatEuro(total)}
                </p>
              </div>
            </div>
          ) : null}

          {service === "repair" ? (
            <div className="space-y-4">
              <Stepper
                id="repair-hours"
                label="Number of hours"
                value={hours}
                min={1}
                max={12}
                onChange={setHours}
              />
              <Stepper
                id="repair-workers"
                label="Number of technicians"
                value={workers}
                min={1}
                max={6}
                onChange={setWorkers}
              />
              <p className="text-sm text-muted">
                {hours} h × {workers} technician{workers > 1 ? "s" : ""} × 20€ = {formatEuro(total)}
              </p>
            </div>
          ) : null}

          {service === "massage" ? (
            <div>
              <p className="mb-2 text-sm font-medium text-ink">Session duration</p>
              <div className="grid gap-2">
                {MASSAGE_OPTIONS.map((option) => {
                  const active = massageMinutes === option.minutes;
                  return (
                    <button
                      key={option.minutes}
                      type="button"
                      onClick={() => setMassageMinutes(option.minutes)}
                      className={`flex items-center justify-between border px-4 py-3 text-left transition ${
                        active
                          ? "border-olive bg-olive/10 text-ink"
                          : "border-mist bg-white text-ink hover:border-olive"
                      }`}
                    >
                      <span className="font-medium">{option.minutes} minutes</span>
                      <span className="font-display text-lg font-bold">{formatEuro(option.price)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="space-y-4 border-t border-mist pt-6">
            <div>
              <label htmlFor="order-name" className="mb-2 block text-sm font-medium text-ink">
                Name
              </label>
              <input
                id="order-name"
                name="name"
                type="text"
                required
                autoComplete="name"
                placeholder="Your name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full border border-mist bg-white px-4 py-3 text-ink outline-none transition placeholder:text-muted/60 focus:border-olive"
              />
            </div>

            <div>
              <label htmlFor="order-phone" className="mb-2 block text-sm font-medium text-ink">
                Phone
              </label>
              <input
                id="order-phone"
                name="phone"
                type="tel"
                required
                autoComplete="tel"
                placeholder="+351 ..."
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                className="w-full border border-mist bg-white px-4 py-3 text-ink outline-none transition placeholder:text-muted/60 focus:border-olive"
              />
            </div>

            <div>
              <label htmlFor="order-date" className="mb-2 block text-sm font-medium text-ink">
                Date
              </label>
              <input
                id="order-date"
                name="date"
                type="date"
                required
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="w-full border border-mist bg-white px-4 py-3 text-ink outline-none transition focus:border-olive"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={sending}
            className="w-full bg-olive px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-olive-deep disabled:opacity-60 sm:text-base"
          >
            {sending ? "Sending..." : `Confirm order — ${formatEuro(total)}`}
          </button>

          {error ? (
            <p className="text-sm font-medium text-danger" role="alert">
              {error}
            </p>
          ) : null}

          {success ? (
            <p className="text-sm font-medium text-olive" role="status">
              Request received for {meta.title} ({formatEuro(total)}). We’ll be in touch shortly.
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}

export default function Home() {
  const [modalOpen, setModalOpen] = useState(false);
  const [service, setService] = useState<ServiceValue>("cleaning");
  const [activeServiceView, setActiveServiceView] = useState<ServiceValue | null>(null);
  const [lockService, setLockService] = useState(false);
  const [massageStyle, setMassageStyle] = useState("");
  const [includedService, setIncludedService] = useState<ServiceValue>("cleaning");
  const [cleaningTab, setCleaningTab] = useState<CleaningRoomTab>("Kitchen");
  const [massageTab, setMassageTab] = useState<MassageFocusTab>("Back");
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [navOpen, setNavOpen] = useState(false);

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

  function openOrder(value: ServiceValue, locked = false, style = "") {
    setService(value);
    setLockService(locked);
    setMassageStyle(value === "massage" ? style : "");
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
            aria-label="HAVENLY home"
          >
            HAVENLY
          </button>

          <nav className="hidden items-center gap-7 lg:flex" aria-label="Primary">
            {NAV_LINKS.map((link) => (
              <button
                key={link.href}
                type="button"
                onClick={() => onNavClick(link.href)}
                className="text-sm font-medium text-white/85 transition hover:text-white"
              >
                {link.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-3 sm:gap-4">
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
              Book
            </button>
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center border border-white/30 text-white lg:hidden"
              aria-expanded={navOpen}
              aria-controls="mobile-nav"
              aria-label={navOpen ? "Close menu" : "Open menu"}
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
            <nav className="mx-auto flex max-w-6xl flex-col gap-1" aria-label="Mobile">
              {NAV_LINKS.map((link) => (
                <button
                  key={link.href}
                  type="button"
                  onClick={() => onNavClick(link.href)}
                  className="rounded-lg px-3 py-3 text-left text-base font-medium text-white/90 transition hover:bg-white/10 hover:text-white"
                >
                  {link.label}
                </button>
              ))}
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
                Book Cleaning
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
            onBook={(style) => openOrder(activeServiceView, true, style)}
          />
        ) : (
          <>
            <section className="relative min-h-[100svh] overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={LANDING_MEDIA.hero}
                alt="Sunlit luxury villa with pool terrace"
                className="animate-hero-media absolute inset-0 h-full w-full object-cover object-[58%_center] sm:object-center"
              />
              {/* Warm Mediterranean wash — amber/sand, not cool blue-grey */}
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(43,32,18,0.28)_0%,rgba(27,37,33,0.35)_42%,rgba(27,37,33,0.88)_100%)]" />
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_80%,rgba(181,154,107,0.22)_0%,transparent_55%)]" />

              <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-6xl flex-col justify-end px-5 pb-7 pt-28 sm:px-8 sm:pb-12 lg:px-10 lg:pb-16">
                <div className="animate-rise max-w-3xl">
                  <p className="text-[0.7rem] font-medium tracking-[0.28em] text-sand/90 uppercase sm:text-xs">
                    Central Algarve
                  </p>
                  <h1 className="mt-4 max-w-[14ch] font-display text-[2.35rem] font-medium leading-[1.08] tracking-[-0.01em] text-white sm:mt-5 sm:max-w-[16ch] sm:text-5xl lg:text-[3.55rem] lg:leading-[1.05]">
                    Elevated home care for life in the Algarve.
                  </h1>
                  <p className="mt-4 max-w-md text-[0.98rem] leading-relaxed text-white/82 sm:mt-5 sm:text-lg lg:max-w-lg">
                    <span className="lg:hidden">
                      Cleaning, repairs and wellness for villas from Faro to Albufeira.
                    </span>
                    <span className="hidden lg:inline">
                      Cleaning, repairs and wellness — delivered with discretion for villas
                      and residences from Faro to Albufeira.
                    </span>
                  </p>
                </div>

                <div
                  id="services"
                  className="animate-rise-late mt-10 hidden grid-cols-3 gap-5 lg:mt-14 lg:grid"
                >
                  {HERO_SERVICES.map((item) => (
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
                  aria-label="Services"
                >
                  {HERO_SERVICES.map((item) => (
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
                      Verified Professionals
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
                      Carefully checked specialists you can trust in your home.
                    </p>
                  </Reveal>
                  <Reveal style={{ transitionDelay: "60ms" }}>
                    <h2 className="font-display text-xl font-medium text-olive sm:text-2xl">
                      English-speaking Support
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
                      Clear communication from first message to finished job.
                    </p>
                  </Reveal>
                  <Reveal style={{ transitionDelay: "120ms" }}>
                    <h2 className="font-display text-xl font-medium text-olive sm:text-2xl">
                      Transparent Pricing
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
                      Straightforward rates with no hidden extras.
                    </p>
                  </Reveal>
                  <Reveal style={{ transitionDelay: "180ms" }}>
                    <h2 className="font-display text-xl font-medium text-olive sm:text-2xl">
                      Secure Booking
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
                      Simple requests and reliable confirmation every time.
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
                    How it works
                  </p>
                  <h2 className="mt-4 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl lg:text-[2.75rem]">
                    What&apos;s included in our service
                  </h2>
                  <p className="mt-4 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
                    Clear checklists so you know exactly what to expect before booking.
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
                          HERO_SERVICES.find((s) => s.id === includedService)?.imageAlt ??
                          SERVICE_META[includedService].title
                        }
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-ink/50 via-transparent to-ink/10" />
                      <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
                        <p className="font-display text-2xl font-medium text-white sm:text-3xl">
                          {SERVICE_META[includedService].title}
                        </p>
                        <p className="mt-1 text-sm text-white/75">
                          {SERVICE_META[includedService].rateLabel}
                        </p>
                      </div>
                    </div>
                  </Reveal>

                  <div>
                    <div className="flex flex-wrap gap-2 border-b border-mist/80 pb-5">
                      {(Object.keys(SERVICE_META) as ServiceValue[]).map((value) => {
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
                            {SERVICE_META[value].title}
                          </button>
                        );
                      })}
                    </div>

                    {includedService === "cleaning" ? (
                      <div className="mt-6">
                        <div className="flex flex-wrap gap-2">
                          {(Object.keys(CLEANING_CHECKLISTS) as CleaningRoomTab[]).map((tab) => {
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
                                {tab}
                              </button>
                            );
                          })}
                        </div>
                        <ul className="mt-6 divide-y divide-mist/70 border-t border-mist/70">
                          {CLEANING_CHECKLISTS[cleaningTab].map((item) => (
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
                          {(Object.keys(MASSAGE_CHECKLISTS) as MassageFocusTab[]).map((tab) => {
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
                                {tab}
                              </button>
                            );
                          })}
                        </div>
                        <ul className="mt-6 divide-y divide-mist/70 border-t border-mist/70">
                          {MASSAGE_CHECKLISTS[massageTab].map((item) => (
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
                          Handyman essentials
                        </p>
                        <ul className="mt-4 divide-y divide-mist/70 border-t border-mist/70">
                          {REPAIR_CHECKLIST.map((item) => (
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
                      Explore {SERVICE_META[includedService].title}
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
                    Coverage
                  </p>
                  <h2 className="mt-3 font-display text-3xl font-medium tracking-tight sm:text-4xl lg:text-[2.75rem]">
                    Serving Central Algarve
                  </h2>
                  <p className="mt-5 text-lg leading-relaxed text-ink sm:text-xl">
                    Faro · Loulé · Quarteira · Vilamoura · Almancil · Albufeira
                  </p>
                  <p className="mt-4 max-w-xl text-muted">
                    Phase one of our service area — more locations coming soon.
                  </p>
                </Reveal>
              </div>
            </section>

            <section className="relative overflow-hidden py-20 sm:py-24">
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,_#e7ddce_0%,_#f7f5f0_48%,_#e7ddce_100%)]" />
              <div className="relative mx-auto max-w-6xl px-5 text-center sm:px-8 lg:px-10">
                <Reveal>
                  <h2 className="font-display text-3xl font-medium tracking-tight sm:text-4xl lg:text-[2.75rem]">
                    Ready when your home is.
                  </h2>
                  <p className="mx-auto mt-3 max-w-md text-muted sm:text-lg">
                    Choose a service, review the details, then confirm your booking.
                  </p>
                  <button
                    type="button"
                    onClick={() => openServiceView("cleaning")}
                    className="mt-8 inline-flex items-center bg-olive px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-olive-deep sm:text-base"
                  >
                    Book Cleaning
                  </button>
                  <p className="mt-6 text-sm text-muted">
                    Or call us now:{" "}
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
                    FAQ
                  </p>
                  <h2 className="mt-3 font-display text-3xl font-medium tracking-tight sm:text-4xl lg:text-[2.75rem]">
                    Questions before you book
                  </h2>
                  <p className="mt-3 text-muted sm:text-lg">
                    Straightforward answers about service, payment and care standards.
                  </p>
                  <div className="mt-8 divide-y divide-mist overflow-hidden rounded-2xl border border-mist bg-white/90">
                    {FAQ_ITEMS.map((item, index) => {
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
            <p className="mt-2 text-sm tracking-[0.08em] text-sand/80">
              Home • Comfort • Trust
            </p>
            <p className="mt-4 text-sm text-sand/60">© 2026 HAVENLY · Central Algarve</p>
          </div>

          <div>
            <p className="text-sm font-semibold tracking-[0.14em] text-white uppercase">
              Quick Links
            </p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li>
                <button
                  type="button"
                  onClick={() => openServiceView("cleaning")}
                  className="transition hover:text-white"
                >
                  Cleaning
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => openServiceView("repair")}
                  className="transition hover:text-white"
                >
                  Repairs
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => openServiceView("massage")}
                  className="transition hover:text-white"
                >
                  Massage
                </button>
              </li>
              <li>
                <a
                  href="#faq"
                  className="transition hover:text-white"
                  onClick={() => setActiveServiceView(null)}
                >
                  FAQ
                </a>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-sm font-semibold tracking-[0.14em] text-white uppercase">
              Coverage Area
            </p>
            <p className="mt-4 text-sm leading-relaxed text-sand/80">
              Faro, Loulé, Quarteira, Vilamoura, Almancil, Albufeira
            </p>
            <a
              href="tel:+351920024478"
              className="mt-5 inline-flex text-lg font-semibold text-white transition hover:text-sand"
            >
              +351 920 024 478
            </a>
          </div>
        </div>
      </footer>

      <OrderModal
        open={modalOpen}
        service={service}
        onServiceChange={setService}
        onClose={() => {
          setModalOpen(false);
          setMassageStyle("");
        }}
        lockService={lockService}
        massageStyle={massageStyle}
      />
    </div>
  );
}
