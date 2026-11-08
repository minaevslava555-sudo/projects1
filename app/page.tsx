"use client";

import "./havenly.css";

import {
  FormEvent,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

type ServiceValue = "cleaning" | "repair" | "massage";

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
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [service, setService] = useState<ServiceValue | "">("");
  const [success, setSuccess] = useState(false);

  function chooseService(value: ServiceValue) {
    setService(value);
    setSuccess(false);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    setSuccess(true);
    setName("");
    setPhone("");
    setService("");
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
          <div className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/50 to-ink/25" />
          <div className="relative mx-auto flex min-h-[100svh] max-w-6xl flex-col justify-end px-5 pb-16 pt-28 sm:px-8 sm:pb-20 lg:px-10 lg:pb-24">
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
              <a
                href="#order"
                className="inline-flex items-center bg-khaki px-6 py-3.5 text-sm font-semibold text-white transition duration-300 hover:bg-khaki-deep sm:text-base"
              >
                Book a Service
              </a>
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
                    <p className="mt-6 font-display text-2xl font-bold text-ink">from 20€</p>
                    <a
                      href="#order"
                      className="mt-5 inline-flex w-full items-center justify-center bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-khaki-deep"
                      onClick={() => chooseService("cleaning")}
                    >
                      Choose
                    </a>
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
                    <p className="mt-6 font-display text-2xl font-bold text-ink">from 20€</p>
                    <a
                      href="#order"
                      className="mt-5 inline-flex w-full items-center justify-center bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-khaki-deep"
                      onClick={() => chooseService("repair")}
                    >
                      Choose
                    </a>
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
                    <p className="mt-6 font-display text-2xl font-bold text-ink">from 45€</p>
                    <a
                      href="#order"
                      className="mt-5 inline-flex w-full items-center justify-center bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-khaki-deep"
                      onClick={() => chooseService("massage")}
                    >
                      Choose
                    </a>
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

        <section id="order" className="relative overflow-hidden py-20 sm:py-24">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,_#eef1ea_0%,_#f7f5f0_48%,_#e8ebe3_100%)]" />
          <div className="pointer-events-none absolute -right-24 top-10 h-64 w-64 rounded-full bg-sand/40 blur-3xl" />
          <div className="relative mx-auto max-w-6xl px-5 sm:px-8 lg:px-10">
            <Reveal className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-start lg:gap-16">
              <div>
                <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
                  Request a booking
                </h2>
                <p className="mt-3 max-w-md text-muted sm:text-lg">
                  Leave your name and phone — we’ll call back within 15 minutes to
                  confirm the details.
                </p>
                <p className="mt-8 text-sm text-muted">
                  Or call us now:{" "}
                  <a
                    href="tel:+351920024478"
                    className="font-medium text-khaki underline-offset-4 hover:underline"
                  >
                    +351 920 024 478
                  </a>
                </p>
              </div>

              <form
                id="order-form"
                className="border border-mist bg-white/80 p-6 backdrop-blur-sm sm:p-8"
                noValidate
                onSubmit={onSubmit}
              >
                <div className="space-y-5">
                  <div>
                    <label htmlFor="name" className="mb-2 block text-sm font-medium text-ink">
                      Name
                    </label>
                    <input
                      id="name"
                      name="name"
                      type="text"
                      required
                      autoComplete="name"
                      placeholder="Your name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="w-full border border-mist bg-paper px-4 py-3 text-ink outline-none transition placeholder:text-muted/60 focus:border-khaki"
                    />
                  </div>

                  <div>
                    <label htmlFor="phone" className="mb-2 block text-sm font-medium text-ink">
                      Phone
                    </label>
                    <input
                      id="phone"
                      name="phone"
                      type="tel"
                      required
                      autoComplete="tel"
                      placeholder="+351 ..."
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      className="w-full border border-mist bg-paper px-4 py-3 text-ink outline-none transition placeholder:text-muted/60 focus:border-khaki"
                    />
                  </div>

                  <div>
                    <label htmlFor="service" className="mb-2 block text-sm font-medium text-ink">
                      Service
                    </label>
                    <select
                      id="service"
                      name="service"
                      required
                      value={service}
                      onChange={(event) => setService(event.target.value as ServiceValue | "")}
                      className="w-full appearance-none border border-mist bg-paper px-4 py-3 text-ink outline-none transition focus:border-khaki"
                    >
                      <option value="" disabled>
                        Select a service
                      </option>
                      <option value="cleaning">Cleaning — from 20€</option>
                      <option value="repair">Home Repairs — from 20€</option>
                      <option value="massage">Massage — from 45€</option>
                    </select>
                  </div>
                </div>

                <button
                  type="submit"
                  className="mt-7 w-full bg-khaki px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-khaki-deep sm:text-base"
                >
                  Submit
                </button>

                {success ? (
                  <p className="mt-4 text-sm font-medium text-khaki" role="status">
                    Request received. We’ll be in touch shortly.
                  </p>
                ) : null}
              </form>
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
    </div>
  );
}
