"use client";

import {
  MASSAGE_OPTIONS,
  buildTimeSlots,
  cleaningPlan,
  cleaningPriceEuro,
  formatEuro,
  massagePriceEuro,
  type BookingService,
  type MassageMinutes,
} from "@/lib/booking-pricing";
import {
  getMassageCategory,
  type MassageCategoryId,
} from "@/lib/massage-catalog";
import TurnstileWidget from "@/components/turnstile-widget";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

function cleanerLabel(count: number) {
  return count === 1 ? "1 cleaner" : `${count} cleaners`;
}

const SERVICE_META: Record<
  BookingService,
  { title: string; rateLabel: string }
> = {
  cleaning: {
    title: "Cleaning",
    rateLabel: "20€ / hour per cleaner",
  },
  repair: {
    title: "Home Repairs",
    rateLabel: "Quote after assessment",
  },
  massage: {
    title: "Massage",
    rateLabel: "45€ / hour",
  },
};

const TIME_SLOTS = buildTimeSlots();

type StepId = "configure" | "schedule" | "address" | "contact" | "review";

const STEPS: StepId[] = ["configure", "schedule", "address", "contact", "review"];

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
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          className="inline-flex h-11 w-11 items-center justify-center border border-mist bg-white text-lg text-ink transition hover:border-olive disabled:opacity-40"
        >
          −
        </button>
        <input
          id={id}
          type="number"
          readOnly
          value={value}
          className="w-full border border-mist bg-white px-4 py-3 text-center text-ink outline-none"
        />
        <button
          type="button"
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          className="inline-flex h-11 w-11 items-center justify-center border border-mist bg-white text-lg text-ink transition hover:border-olive disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  "w-full border border-mist bg-white px-4 py-3 text-ink outline-none transition placeholder:text-muted/60 focus:border-olive";

export default function BookingWizard({
  open,
  service,
  onServiceChange,
  onClose,
  lockService = false,
  massageCategoryId = null,
}: {
  open: boolean;
  service: BookingService;
  onServiceChange: (service: BookingService) => void;
  onClose: () => void;
  lockService?: boolean;
  massageCategoryId?: MassageCategoryId | null;
}) {
  const titleId = useId();
  const [stepIndex, setStepIndex] = useState(0);
  const [rooms, setRooms] = useState(2);
  const [massageMinutes, setMassageMinutes] = useState<MassageMinutes>(60);
  const [problemDescription, setProblemDescription] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftToken, setDraftToken] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);
  const [repairPhotoPaths, setRepairPhotoPaths] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [date, setDate] = useState("");
  const [preferredTime, setPreferredTime] = useState("10:00");
  const [streetAddress, setStreetAddress] = useState("");
  const [city, setCity] = useState("");
  const [apartmentFloor, setApartmentFloor] = useState("");
  const [accessInstructions, setAccessInstructions] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [successRef, setSuccessRef] = useState<string | null>(null);
  const bookingContextRef = useRef({ service, massageCategoryId });

  const step = STEPS[stepIndex] ?? "configure";
  const cleaning = useMemo(() => cleaningPlan(rooms), [rooms]);
  const massageCategory = massageCategoryId
    ? getMassageCategory(massageCategoryId)
    : null;

  const total = useMemo(() => {
    if (service === "massage") return massagePriceEuro(massageMinutes) ?? 45;
    if (service === "cleaning") return cleaningPriceEuro(rooms);
    return null;
  }, [service, massageMinutes, rooms]);

  function resetWizardFields() {
    setStepIndex(0);
    setRooms(2);
    setMassageMinutes(60);
    setProblemDescription("");
    setDraftId(null);
    setDraftToken(null);
    setIdempotencyKey(crypto.randomUUID());
    setTurnstileToken(null);
    setTurnstileKey((value) => value + 1);
    setRepairPhotoPaths([]);
    setUploading(false);
    setDate("");
    setPreferredTime("10:00");
    setStreetAddress("");
    setCity("");
    setApartmentFloor("");
    setAccessInstructions("");
    setName("");
    setPhone("");
    setSending(false);
    setError("");
    setSuccessRef(null);
  }

  async function ensureDraft() {
    if (draftToken && draftId) return { draftId, draftToken };
    const response = await fetch("/api/order/draft", { method: "POST" });
    const data = (await response.json()) as {
      ok?: boolean;
      draftId?: string;
      draftToken?: string;
      error?: string;
    };
    if (!response.ok || !data.ok || !data.draftId || !data.draftToken) {
      throw new Error(data.error || "Не удалось открыть бронирование");
    }
    setDraftId(data.draftId);
    setDraftToken(data.draftToken);
    return { draftId: data.draftId, draftToken: data.draftToken };
  }

  // Fresh mount (parent key) starts at Step 1. Switching service mid-session resets fields.
  // Back/Next within the same service keep entered data.
  useEffect(() => {
    const prev = bookingContextRef.current;
    if (
      prev.service !== service ||
      prev.massageCategoryId !== massageCategoryId
    ) {
      bookingContextRef.current = { service, massageCategoryId };
      resetWizardFields();
    }
  }, [service, massageCategoryId]);

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

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/order/draft", { method: "POST" });
        const data = (await response.json()) as {
          ok?: boolean;
          draftId?: string;
          draftToken?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !data.ok || !data.draftId || !data.draftToken) {
          setError(data.error || "Не удалось открыть бронирование");
          return;
        }
        setDraftId(data.draftId);
        setDraftToken(data.draftToken);
      } catch {
        if (!cancelled) setError("Не удалось открыть бронирование");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, service, massageCategoryId, idempotencyKey]);

  function validateStep(current: StepId): string | null {
    if (current === "configure") {
      if (service === "repair" && problemDescription.trim().length < 10) {
        return "Describe the repair in a bit more detail";
      }
      return null;
    }
    if (current === "schedule") {
      if (!date) return "Choose a date";
      if (!preferredTime) return "Choose a preferred time";
      return null;
    }
    if (current === "address") {
      if (!streetAddress.trim() || !city.trim()) return "Enter street address and city";
      return null;
    }
    if (current === "contact") {
      if (!name.trim() || !phone.trim()) return "Enter your name and phone";
      return null;
    }
    return null;
  }

  function goNext() {
    const message = validateStep(step);
    if (message) {
      setError(message);
      return;
    }
    setError("");
    setStepIndex((value) => Math.min(STEPS.length - 1, value + 1));
  }

  function goBack() {
    setError("");
    setStepIndex((value) => Math.max(0, value - 1));
  }

  async function onUploadPhotos(fileList: FileList | null) {
    if (!fileList?.length) return;
    const remaining = 5 - repairPhotoPaths.length;
    if (remaining <= 0) {
      setError("Maximum 5 photos");
      return;
    }
    if (!turnstileToken) {
      setError("Complete the security check before uploading photos");
      return;
    }

    setUploading(true);
    setError("");
    try {
      const draft = await ensureDraft();
      const files = Array.from(fileList).slice(0, remaining);
      const uploaded: string[] = [];
      for (const file of files) {
        const body = new FormData();
        body.set("draftToken", draft.draftToken);
        body.set("turnstileToken", turnstileToken);
        body.set("file", file);
        const response = await fetch("/api/order/photos", {
          method: "POST",
          body,
        });
        const data = (await response.json()) as { ok?: boolean; path?: string; error?: string };
        if (!response.ok || !data.ok || !data.path) {
          throw new Error(data.error || "Photo upload failed");
        }
        uploaded.push(data.path);
      }
      setRepairPhotoPaths((prev) => [...prev, ...uploaded]);
      // Refresh Turnstile after upload — tokens are typically single-use
      setTurnstileToken(null);
      setTurnstileKey((value) => value + 1);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Photo upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || successRef) return;

    for (const id of STEPS) {
      const message = validateStep(id);
      if (message) {
        setError(message);
        setStepIndex(STEPS.indexOf(id));
        return;
      }
    }

    if (!turnstileToken) {
      setError("Complete the security check before submitting");
      return;
    }

    setSending(true);
    setError("");

    try {
      const draft = await ensureDraft();
      const response = await fetch("/api/order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          service,
          date,
          preferredTime,
          streetAddress: streetAddress.trim(),
          city: city.trim(),
          apartmentFloor: apartmentFloor.trim() || undefined,
          accessInstructions: accessInstructions.trim() || undefined,
          rooms: service === "cleaning" ? rooms : undefined,
          massageMinutes: service === "massage" ? massageMinutes : undefined,
          massageCategory:
            service === "massage"
              ? massageCategory?.title || massageCategoryId || undefined
              : undefined,
          problemDescription:
            service === "repair" ? problemDescription.trim() : undefined,
          repairPhotoPaths: service === "repair" ? repairPhotoPaths : undefined,
          draftToken: draft.draftToken,
          turnstileToken,
          idempotencyKey,
        }),
      });

      const contentType = response.headers.get("content-type") || "";
      const rawText = await response.text();
      let data: {
        error?: string;
        ok?: boolean;
        id?: string;
        orderRef?: string;
        telegramOk?: boolean;
      } = {};
      if (contentType.includes("application/json")) {
        try {
          data = JSON.parse(rawText) as typeof data;
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

      if (!response.ok || !data.ok || !data.id || !data.orderRef) {
        throw new Error(data.error || "Не удалось сохранить заказ");
      }
      setSuccessRef(data.orderRef);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Не удалось отправить заказ");
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  const meta = SERVICE_META[service];
  const stepLabel =
    step === "configure"
      ? "Service details"
      : step === "schedule"
        ? "Date & time"
        : step === "address"
          ? "Address"
          : step === "contact"
            ? "Contact"
            : "Review";

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
        className="flex max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden border border-mist bg-paper shadow-2xl sm:max-h-[90svh]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-mist bg-paper px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium tracking-[0.18em] text-gold uppercase">
                Premium booking
              </p>
              <h2 id={titleId} className="mt-1 font-display text-2xl font-medium text-ink">
                {meta.title}
              </h2>
              {massageCategory ? (
                <p className="mt-1 text-sm font-medium text-olive">{massageCategory.title}</p>
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

          {!successRef ? (
            <div className="mt-4">
              <div className="flex gap-1" aria-hidden="true">
                {STEPS.map((id, index) => (
                  <div
                    key={id}
                    className={`h-1 flex-1 ${index <= stepIndex ? "bg-olive" : "bg-mist"}`}
                  />
                ))}
              </div>
              <p className="mt-2 text-xs tracking-[0.14em] text-muted uppercase">
                Step {stepIndex + 1} of {STEPS.length} · {stepLabel}
              </p>
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
        {successRef ? (
          <div className="space-y-4 px-5 py-8 text-center sm:px-6">
            <p className="text-xs font-medium tracking-[0.18em] text-gold uppercase">
              Request received
            </p>
            <p className="font-display text-3xl font-medium text-ink">Thank you</p>
            <p className="text-sm leading-relaxed text-muted">
              Your booking reference is{" "}
              <span className="font-semibold text-olive">{successRef}</span>.
              We will confirm the visit shortly.
            </p>
            {service === "repair" ? (
              <p className="text-sm text-muted">
                Home repair is quoted after assessment — no price was charged at booking.
              </p>
            ) : (
              <p className="text-sm text-muted">
                Estimated total: {formatEuro(total ?? 0)}
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-full bg-olive px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-olive-deep"
            >
              Close
            </button>
          </div>
        ) : (
          <form className="space-y-6 px-5 py-5 sm:px-6 sm:py-6" noValidate onSubmit={onSubmit}>
            {!lockService && step === "configure" ? (
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(SERVICE_META) as BookingService[]).map((value) => (
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

            {step === "configure" && service !== "repair" ? (
              <div className="rounded-xl border border-mist bg-white px-5 py-6 text-center">
                <p className="text-xs font-medium tracking-[0.18em] text-muted uppercase">
                  Total
                </p>
                <p className="mt-2 font-display text-5xl font-bold tracking-tight text-olive sm:text-6xl">
                  {formatEuro(total ?? 0)}
                </p>
              </div>
            ) : null}

            {step === "configure" && service === "repair" ? (
              <div className="rounded-xl border border-sand bg-sand/70 px-4 py-3 text-sm leading-relaxed text-ink">
                <p className="font-medium">Quote on assessment</p>
                <p className="mt-1 text-olive/80">
                  Describe the issue and add optional photos. Final price after we review.
                </p>
              </div>
            ) : null}

            {step === "configure" && service === "cleaning" ? (
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
                    {rooms === 1 ? "1 room" : `${rooms} rooms`} require ~{cleaning.hours}{" "}
                    {cleaning.hours === 1 ? "hour" : "hours"} and {cleanerLabel(cleaning.workers)}
                  </p>
                  <p className="mt-1 text-olive/80">
                    {cleaning.hours} × {cleaning.workers} × 20€ = {formatEuro(total ?? 0)}
                  </p>
                </div>
              </div>
            ) : null}

            {step === "configure" && service === "massage" ? (
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
                        <span className="font-display text-lg font-bold">
                          {formatEuro(option.price)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {step === "configure" && service === "repair" ? (
              <div className="space-y-4">
                <Field id="repair-problem" label="Describe the problem">
                  <textarea
                    id="repair-problem"
                    rows={5}
                    maxLength={2000}
                    value={problemDescription}
                    onChange={(event) => setProblemDescription(event.target.value)}
                    placeholder="What needs fixing? Where is it? Any urgency?"
                    className={inputClass}
                  />
                </Field>
                <div>
                  <p className="mb-2 text-sm font-medium text-ink">
                    Photos (optional, up to 5)
                  </p>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    disabled={uploading || repairPhotoPaths.length >= 5}
                    onChange={(event) => {
                      void onUploadPhotos(event.target.files);
                      event.target.value = "";
                    }}
                    className="block w-full text-sm text-muted file:mr-3 file:border file:border-mist file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ink"
                  />
                  {uploading ? (
                    <p className="mt-2 text-sm text-muted">Uploading…</p>
                  ) : null}
                  {repairPhotoPaths.length ? (
                    <p className="mt-2 text-sm text-olive">
                      {repairPhotoPaths.length} photo(s) attached
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {step === "schedule" ? (
              <div className="space-y-4">
                <Field id="order-date" label="Preferred date">
                  <input
                    id="order-date"
                    type="date"
                    required
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                    className={inputClass}
                  />
                </Field>
                  <div>
                  <p className="mb-2 text-sm font-medium text-ink" id="preferred-time-label">
                    Preferred time
                  </p>
                  <div
                    className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto overscroll-contain sm:grid-cols-4"
                    role="group"
                    aria-labelledby="preferred-time-label"
                  >
                    {TIME_SLOTS.map((slot) => {
                      const active = preferredTime === slot;
                      return (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => setPreferredTime(slot)}
                          aria-pressed={active}
                          aria-label={
                            active
                              ? `Preferred time ${slot}, selected`
                              : `Preferred time ${slot}`
                          }
                          className={`border px-2 py-2.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ${
                            active
                              ? "border-olive bg-olive text-white shadow-sm ring-2 ring-olive ring-offset-2 ring-offset-paper"
                              : "border-mist bg-white text-ink hover:border-olive"
                          }`}
                        >
                          {slot}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-muted" aria-live="polite">
                    Selected: {preferredTime}. Preferred start — we confirm availability
                    separately.
                  </p>
                </div>
              </div>
            ) : null}

            {step === "address" ? (
              <div className="space-y-4">
                <Field id="order-street" label="Street address">
                  <input
                    id="order-street"
                    type="text"
                    autoComplete="street-address"
                    value={streetAddress}
                    onChange={(event) => setStreetAddress(event.target.value)}
                    className={inputClass}
                    placeholder="Street and number"
                  />
                </Field>
                <Field id="order-city" label="City">
                  <input
                    id="order-city"
                    type="text"
                    autoComplete="address-level2"
                    value={city}
                    onChange={(event) => setCity(event.target.value)}
                    className={inputClass}
                    placeholder="Faro, Loulé, …"
                  />
                </Field>
                <Field id="order-floor" label="Apartment / floor (optional)">
                  <input
                    id="order-floor"
                    type="text"
                    value={apartmentFloor}
                    onChange={(event) => setApartmentFloor(event.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field id="order-access" label="Access notes (optional)">
                  <textarea
                    id="order-access"
                    rows={3}
                    value={accessInstructions}
                    onChange={(event) => setAccessInstructions(event.target.value)}
                    className={inputClass}
                    placeholder="Gate code, parking, entry notes"
                  />
                </Field>
              </div>
            ) : null}

            {step === "contact" ? (
              <div className="space-y-4">
                <Field id="order-name" label="Name">
                  <input
                    id="order-name"
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className={inputClass}
                    placeholder="Your name"
                  />
                </Field>
                <Field id="order-phone" label="Phone">
                  <input
                    id="order-phone"
                    type="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    className={inputClass}
                    placeholder="+351 ..."
                  />
                </Field>
              </div>
            ) : null}

            {step === "review" ? (
              <div className="space-y-4 text-sm leading-relaxed text-ink">
                <div className="rounded-xl border border-mist bg-white px-4 py-4">
                  <p className="text-xs tracking-[0.14em] text-muted uppercase">Summary</p>
                  <p className="mt-2 font-display text-xl text-ink">{meta.title}</p>
                  {massageCategory ? (
                    <p className="mt-1 text-olive">{massageCategory.title}</p>
                  ) : null}
                  {service === "cleaning" ? (
                    <p className="mt-2">
                      {rooms === 1 ? "1 room" : `${rooms} rooms`} · ~{cleaning.hours}h ·{" "}
                      {cleanerLabel(cleaning.workers)} · {formatEuro(total ?? 0)}
                    </p>
                  ) : null}
                  {service === "massage" ? (
                    <p className="mt-2">
                      {massageMinutes} min · {formatEuro(total ?? 0)}
                    </p>
                  ) : null}
                  {service === "repair" ? (
                    <p className="mt-2">
                      Quote request · {repairPhotoPaths.length} photo(s)
                    </p>
                  ) : null}
                  <p className="mt-2">
                    {date} at {preferredTime}
                  </p>
                  <p className="mt-1">
                    {[streetAddress, apartmentFloor, city].filter(Boolean).join(", ")}
                  </p>
                  <p className="mt-1">
                    {name} · {phone}
                  </p>
                </div>
              </div>
            ) : null}

            {error ? (
              <p className="text-sm font-medium text-danger" role="alert">
                {error}
              </p>
            ) : null}

            <div className="sticky bottom-0 -mx-5 mt-2 border-t border-mist bg-paper/95 px-5 py-4 backdrop-blur sm:-mx-6 sm:px-6">
              {(service === "repair" || step === "review") && !successRef ? (
                <TurnstileWidget
                  key={turnstileKey}
                  className="mb-3"
                  onToken={setTurnstileToken}
                />
              ) : null}
              <div className="flex gap-2">
                {stepIndex > 0 ? (
                  <button
                    type="button"
                    onClick={goBack}
                    className="flex-1 border border-mist bg-white px-4 py-3.5 text-sm font-semibold text-ink transition hover:border-olive"
                  >
                    Back
                  </button>
                ) : null}
                {step !== "review" ? (
                  <button
                    type="button"
                    onClick={goNext}
                    className="flex-1 bg-olive px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-olive-deep"
                  >
                    Continue
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={sending || uploading}
                    className="flex-1 bg-olive px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-olive-deep disabled:opacity-60"
                  >
                    {sending
                      ? "Sending..."
                      : service === "repair"
                        ? "Request quote"
                        : `Confirm — ${formatEuro(total ?? 0)}`}
                  </button>
                )}
              </div>
            </div>
          </form>
        )}
        </div>
      </div>
    </div>
  );
}
