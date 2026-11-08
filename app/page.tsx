"use client";

import "./havenly.css";

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

type ServiceValue = "cleaning" | "repair" | "massage";
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
          className="inline-flex h-11 w-11 items-center justify-center border border-mist bg-paper text-lg font-semibold text-ink transition hover:border-khaki disabled:opacity-40"
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
          className="w-full border border-mist bg-paper px-4 py-3 text-center text-ink outline-none transition focus:border-khaki"
        />
        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center border border-mist bg-paper text-lg font-semibold text-ink transition hover:border-khaki disabled:opacity-40"
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
}: {
  open: boolean;
  service: ServiceValue;
  onServiceChange: (service: ServiceValue) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const [hours, setHours] = useState(2);
  const [workers, setWorkers] = useState(1);
  const [massageMinutes, setMassageMinutes] = useState<MassageMinutes>(60);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!open) return;
    setHours(2);
    setWorkers(1);
    setMassageMinutes(60);
    setName("");
    setPhone("");
    setDate("");
    setSuccess(false);
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
    return hours * workers * 20;
  }, [service, hours, workers, massageMinutes]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    setSuccess(true);
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
            <p className="text-xs font-medium tracking-[0.18em] text-khaki uppercase">
              Booking calculator
            </p>
            <h2 id={titleId} className="mt-1 font-display text-2xl font-bold text-ink">
              {meta.title}
            </h2>
            <p className="mt-1 text-sm text-muted">{meta.rateLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center border border-mist bg-white text-ink transition hover:border-khaki"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form className="space-y-6 px-5 py-5 sm:px-6 sm:py-6" noValidate onSubmit={onSubmit}>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(SERVICE_META) as ServiceValue[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onServiceChange(value)}
                className={`px-2 py-2.5 text-xs font-semibold transition sm:text-sm ${
                  service === value
                    ? "bg-ink text-white"
                    : "border border-mist bg-white text-ink hover:border-khaki"
                }`}
              >
                {SERVICE_META[value].title}
              </button>
            ))}
          </div>

          <div className="border border-mist bg-white px-5 py-6 text-center">
            <p className="text-xs font-medium tracking-[0.18em] text-muted uppercase">Total</p>
            <p className="mt-2 font-display text-5xl font-bold tracking-tight text-ink sm:text-6xl">
              {formatEuro(total)}
            </p>
          </div>

          {service === "cleaning" ? (
            <div className="space-y-4">
              <Stepper
                id="cleaning-hours"
                label="Number of hours"
                value={hours}
                min={1}
                max={12}
                onChange={setHours}
              />
              <Stepper
                id="cleaning-workers"
                label="Number of cleaners"
                value={workers}
                min={1}
                max={6}
                onChange={setWorkers}
              />
              <p className="text-sm text-muted">
                {hours} h × {workers} cleaner{workers > 1 ? "s" : ""} × 20€ = {formatEuro(total)}
              </p>
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
                          ? "border-khaki bg-khaki/10 text-ink"
                          : "border-mist bg-white text-ink hover:border-khaki"
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
                className="w-full border border-mist bg-white px-4 py-3 text-ink outline-none transition placeholder:text-muted/60 focus:border-khaki"
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
                className="w-full border border-mist bg-white px-4 py-3 text-ink outline-none transition placeholder:text-muted/60 focus:border-khaki"
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
                className="w-full border border-mist bg-white px-4 py-3 text-ink outline-none transition focus:border-khaki"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full bg-khaki px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-khaki-deep sm:text-base"
          >
            Confirm order — {formatEuro(total)}
          </button>

          {success ? (
            <p className="text-sm font-medium text-khaki" role="status">
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

  function openOrder(value: ServiceValue) {
    setService(value);
    setModalOpen(true);
  }

  return (
    <div className="min-h-svh bg-paper font-sans text-ink antialiased">
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
          <a
            href="#top"
            className="font-display text-xl font-bold tracking-[0.12em] text-white sm:text-2xl"
          >
            HAVENLY
          </a>
          <a
            href="tel:+351920024478"
            className="text-sm font-medium text-white/90 transition hover:text-white sm:text-base"
          >
            +351 920 024 478
          </a>
        </div>
      </header>

      <main id="top">
        <section className="relative min-h-[100svh] overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=2000&q=80"
            alt="Bright, calm living room with soft natural light"
            className="animate-hero-media absolute inset-0 h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/50 to-ink/25" />
          <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-6xl flex-col justify-end px-5 pb-16 pt-28 sm:px-8 sm:pb-20 lg:px-10 lg:pb-24">
            <p className="animate-rise font-display text-4xl font-bold tracking-[0.14em] text-white sm:text-5xl md:text-6xl">
              HAVENLY
            </p>
            <p className="animate-rise-delay mt-3 text-xs font-medium tracking-[0.28em] text-white/80 uppercase sm:text-sm">
              Home · Comfort · Trust
            </p>
            <p className="animate-rise-delay mt-2 text-base text-white/85 sm:text-lg">
              Your home, taken care of.
            </p>
            <h1 className="animate-rise-late mt-8 max-w-3xl font-display text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-5xl md:text-6xl lg:text-7xl">
              Your Home. Our Care.
            </h1>
            <p className="animate-rise-late mt-5 max-w-xl text-base leading-relaxed text-white/85 sm:text-lg">
              Everything your home needs, in one place. Professional cleaning, home
              repairs and wellness services — delivered by trusted local
              professionals across the Algarve.
            </p>
            <div className="animate-rise-late mt-8">
              <button
                type="button"
                onClick={() => openOrder("cleaning")}
                className="inline-flex items-center bg-khaki px-6 py-3.5 text-sm font-semibold text-white transition duration-300 hover:bg-khaki-deep sm:text-base"
              >
                Book a Service
              </button>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden border-b border-mist py-16 sm:py-20">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,_#f4f5f1_0%,_#eef0ea_100%)]" />
          <div className="relative mx-auto max-w-6xl px-5 sm:px-8 lg:px-10">
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
              <Reveal>
                <h2 className="font-display text-lg font-bold text-khaki sm:text-xl">
                  Verified Professionals
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-ink sm:text-base">
                  Carefully checked specialists you can trust in your home.
                </p>
              </Reveal>
              <Reveal style={{ transitionDelay: "60ms" }}>
                <h2 className="font-display text-lg font-bold text-khaki sm:text-xl">
                  English-speaking Support
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-ink sm:text-base">
                  Clear communication from first message to finished job.
                </p>
              </Reveal>
              <Reveal style={{ transitionDelay: "120ms" }}>
                <h2 className="font-display text-lg font-bold text-khaki sm:text-xl">
                  Transparent Pricing
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-ink sm:text-base">
                  Straightforward rates with no hidden extras.
                </p>
              </Reveal>
              <Reveal style={{ transitionDelay: "180ms" }}>
                <h2 className="font-display text-lg font-bold text-khaki sm:text-xl">
                  Secure Booking
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-ink sm:text-base">
                  Simple requests and reliable confirmation every time.
                </p>
              </Reveal>
            </div>
          </div>
        </section>

        <section id="services" className="relative overflow-hidden py-20 sm:py-24">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#e4e8dc_0%,_transparent_55%),linear-gradient(180deg,_#f4f5f1_0%,_#eef1ea_100%)]" />
          <div className="relative mx-auto max-w-6xl px-5 sm:px-8 lg:px-10">
            <Reveal className="max-w-xl">
              <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
                Services for everyday life
              </h2>
              <p className="mt-3 text-muted sm:text-lg">
                Choose what you need today — we match you with a local professional.
              </p>
            </Reveal>

            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-7">
              <Reveal className="group flex flex-col overflow-hidden border border-mist bg-white/75 backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:border-khaki/35">
                <article className="flex h-full flex-col">
                  <div className="aspect-[4/3] overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/images/service-cleaning.jpg"
                      alt="Professional cleaner in a bright living room"
                      className="h-full w-full object-cover object-center transition duration-700 group-hover:scale-105"
                    />
                  </div>
                  <div className="flex flex-1 flex-col p-6 sm:p-7">
                    <h3 className="font-display text-xl font-bold text-khaki sm:text-2xl">
                      Cleaning
                    </h3>
                    <p className="mt-3 flex-1 text-sm leading-relaxed text-ink sm:text-base">
                      Full home or apartment cleaning — kitchens, bathrooms, dusting
                      and order, handled with care.
                    </p>
                    <p className="mt-6 font-display text-2xl font-bold text-ink">
                      {SERVICE_META.cleaning.cardPrice}
                    </p>
                    <button
                      type="button"
                      className="mt-5 inline-flex w-full items-center justify-center bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-khaki-deep"
                      onClick={() => openOrder("cleaning")}
                    >
                      Choose
                    </button>
                  </div>
                </article>
              </Reveal>

              <Reveal
                className="group flex flex-col overflow-hidden border border-mist bg-white/75 backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:border-khaki/35"
                style={{ transitionDelay: "80ms" }}
              >
                <article className="flex h-full flex-col">
                  <div className="aspect-[4/3] overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/images/service-repair.jpg"
                      alt="Handyman in workwear installing a shelf at home"
                      className="h-full w-full object-cover object-center transition duration-700 group-hover:scale-105"
                    />
                  </div>
                  <div className="flex flex-1 flex-col p-6 sm:p-7">
                    <h3 className="font-display text-xl font-bold text-khaki sm:text-2xl">
                      Home Repairs
                    </h3>
                    <p className="mt-3 flex-1 text-sm leading-relaxed text-ink sm:text-base">
                      Furniture assembly, shelves, taps and everyday fixes — without
                      the long wait.
                    </p>
                    <p className="mt-6 font-display text-2xl font-bold text-ink">
                      {SERVICE_META.repair.cardPrice}
                    </p>
                    <button
                      type="button"
                      className="mt-5 inline-flex w-full items-center justify-center bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-khaki-deep"
                      onClick={() => openOrder("repair")}
                    >
                      Choose
                    </button>
                  </div>
                </article>
              </Reveal>

              <Reveal
                className="group flex flex-col overflow-hidden border border-mist bg-white/75 backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:border-khaki/35 sm:col-span-2 sm:mx-auto sm:max-w-md lg:col-span-1 lg:mx-0 lg:max-w-none"
                style={{ transitionDelay: "160ms" }}
              >
                <article className="flex h-full flex-col">
                  <div className="aspect-[4/3] overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/images/service-massage.jpg"
                      alt="Relaxing warm-toned massage with one client"
                      className="h-full w-full object-cover object-center transition duration-700 group-hover:scale-105"
                    />
                  </div>
                  <div className="flex flex-1 flex-col p-6 sm:p-7">
                    <h3 className="font-display text-xl font-bold text-khaki sm:text-2xl">
                      Massage
                    </h3>
                    <p className="mt-3 flex-1 text-sm leading-relaxed text-ink sm:text-base">
                      Relaxing or therapeutic massage at home — booked around your
                      schedule.
                    </p>
                    <p className="mt-6 font-display text-2xl font-bold text-ink">
                      {SERVICE_META.massage.cardPrice}
                    </p>
                    <button
                      type="button"
                      className="mt-5 inline-flex w-full items-center justify-center bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-khaki-deep"
                      onClick={() => openOrder("massage")}
                    >
                      Choose
                    </button>
                  </div>
                </article>
              </Reveal>
            </div>
          </div>
        </section>

        <section id="area" className="relative overflow-hidden border-y border-mist py-20 sm:py-24">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,_#eef1ea_0%,_#f5f3ee_50%,_#e8ebe3_100%)]" />
          <div className="relative mx-auto max-w-6xl px-5 sm:px-8 lg:px-10">
            <Reveal className="max-w-3xl">
              <p className="text-sm font-medium tracking-[0.22em] text-khaki uppercase">
                Coverage
              </p>
              <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
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
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,_#eef1ea_0%,_#f7f5f0_48%,_#e8ebe3_100%)]" />
          <div className="relative mx-auto max-w-6xl px-5 text-center sm:px-8 lg:px-10">
            <Reveal>
              <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
                Ready to book?
              </h2>
              <p className="mx-auto mt-3 max-w-md text-muted sm:text-lg">
                Open the calculator, pick a service and confirm your order in a minute.
              </p>
              <button
                type="button"
                onClick={() => openOrder("cleaning")}
                className="mt-8 inline-flex items-center bg-khaki px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-khaki-deep sm:text-base"
              >
                Open booking calculator
              </button>
              <p className="mt-6 text-sm text-muted">
                Or call us now:{" "}
                <a
                  href="tel:+351920024478"
                  className="font-medium text-khaki underline-offset-4 hover:underline"
                >
                  +351 920 024 478
                </a>
              </p>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="border-t border-mist bg-ink py-8 text-white/70">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
          <div>
            <p className="font-display text-lg font-bold tracking-[0.12em] text-white">
              HAVENLY
            </p>
            <p className="mt-1 text-xs tracking-[0.18em] text-white/55 uppercase">
              Home · Comfort · Trust
            </p>
          </div>
          <p className="text-sm">© 2026 HAVENLY · Central Algarve</p>
        </div>
      </footer>

      <OrderModal
        open={modalOpen}
        service={service}
        onServiceChange={setService}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
