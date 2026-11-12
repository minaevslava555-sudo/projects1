"use client";

import LanguageSwitcher from "@/components/language-switcher";
import TurnstileWidget from "@/components/turnstile-widget";
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
import { useTranslations } from "next-intl";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

type StepId = "configure" | "schedule" | "address" | "contact" | "review";

type RepairPhotoStatus = "uploading" | "uploaded" | "failed";

type RepairPhotoItem = {
  id: string;
  fileName: string;
  status: RepairPhotoStatus;
  path?: string;
  error?: string;
  file?: File;
  previewUrl: string;
};

type ErrorCode =
  | "draftOpenFailed"
  | "repairDetail"
  | "chooseDate"
  | "chooseTime"
  | "addressRequired"
  | "contactRequired"
  | "photoUploadFailed"
  | "noPhotoSelected"
  | "noPhotoReplace"
  | "photoType"
  | "photoSize"
  | "maxPhotos"
  | "retryChooseAgain"
  | "fixFailedPhotos"
  | "photosOrConfirm"
  | "turnstileRequired"
  | "badJson"
  | "notJson"
  | "serverStatus"
  | "emptyResponse"
  | "saveFailed"
  | "submitFailed";

type WizardError =
  | { kind: "code"; code: ErrorCode; values?: Record<string, string | number> }
  | { kind: "raw"; message: string };

const ACCEPTED_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

const PHOTO_ACCEPT =
  "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

function isAcceptedPhotoFile(file: File) {
  if (ACCEPTED_PHOTO_TYPES.has(file.type)) return true;
  return /\.(jpe?g|png|webp)$/i.test(file.name);
}

function revokePreview(url: string | undefined) {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}

const STEPS: StepId[] = ["configure", "schedule", "address", "contact", "review"];
const SERVICES: BookingService[] = ["cleaning", "repair", "massage"];
const TIME_SLOTS = buildTimeSlots();

function Stepper({
  id,
  label,
  value,
  min,
  max,
  onChange,
  decreaseLabel,
  increaseLabel,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  decreaseLabel: string;
  increaseLabel: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-ink">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={decreaseLabel}
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
          aria-label={increaseLabel}
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
  const t = useTranslations("BookingWizard");
  const tMassage = useTranslations("MassageCatalog");
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
  const [repairPhotos, setRepairPhotos] = useState<RepairPhotoItem[]>([]);
  const [allowWithoutPhotos, setAllowWithoutPhotos] = useState(false);
  const [date, setDate] = useState("");
  const [preferredTime, setPreferredTime] = useState("10:00");
  const [streetAddress, setStreetAddress] = useState("");
  const [city, setCity] = useState("");
  const [apartmentFloor, setApartmentFloor] = useState("");
  const [accessInstructions, setAccessInstructions] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<WizardError | null>(null);
  const [successRef, setSuccessRef] = useState<string | null>(null);
  const bookingContextRef = useRef({ service, massageCategoryId });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceTargetIdRef = useRef<string | null>(null);
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);

  const step = STEPS[stepIndex] ?? "configure";
  const cleaning = useMemo(() => cleaningPlan(rooms), [rooms]);
  const massageCategory = massageCategoryId
    ? getMassageCategory(massageCategoryId)
    : null;

  const repairPhotoPaths = useMemo(
    () =>
      repairPhotos
        .filter((item) => item.status === "uploaded" && item.path)
        .map((item) => item.path as string),
    [repairPhotos],
  );
  const hasUploadingPhotos = repairPhotos.some((item) => item.status === "uploading");
  const hasFailedPhotos = repairPhotos.some((item) => item.status === "failed");
  const uploadedPhotoCount = repairPhotoPaths.length;
  const occupiedPhotoSlots = repairPhotos.length;
  const failedPhotoCount = repairPhotos.filter((item) => item.status === "failed").length;

  const total = useMemo(() => {
    if (service === "massage") return massagePriceEuro(massageMinutes) ?? 45;
    if (service === "cleaning") return cleaningPriceEuro(rooms);
    return null;
  }, [service, massageMinutes, rooms]);

  function setErrorCode(
    code: ErrorCode,
    values?: Record<string, string | number>,
  ) {
    setError({ kind: "code", code, values });
  }

  function setRawError(message: string) {
    setError({ kind: "raw", message });
  }

  function clearError() {
    setError(null);
  }

  function clearRepairPhotos() {
    setRepairPhotos((prev) => {
      for (const item of prev) revokePreview(item.previewUrl);
      return [];
    });
  }

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
    clearRepairPhotos();
    setAllowWithoutPhotos(false);
    setDate("");
    setPreferredTime("10:00");
    setStreetAddress("");
    setCity("");
    setApartmentFloor("");
    setAccessInstructions("");
    setName("");
    setPhone("");
    setSending(false);
    clearError();
    setSuccessRef(null);
  }

  function updateRepairPhoto(id: string, patch: Partial<RepairPhotoItem>) {
    setRepairPhotos((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function removeRepairPhoto(id: string) {
    setRepairPhotos((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) revokePreview(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
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
      throw new Error(data.error || t("errors.draftOpenFailed"));
    }
    setDraftId(data.draftId);
    setDraftToken(data.draftToken);
    return { draftId: data.draftId, draftToken: data.draftToken };
  }

  // Fresh mount (parent key) starts at Step 1. Switching service mid-session resets fields.
  // Back/Next within the same service keep entered data. Locale switch must not reset.
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
          if (data.error) setRawError(data.error);
          else setErrorCode("draftOpenFailed");
          return;
        }
        setDraftId(data.draftId);
        setDraftToken(data.draftToken);
      } catch {
        if (!cancelled) setErrorCode("draftOpenFailed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, service, massageCategoryId, idempotencyKey]);

  function validateStep(current: StepId): ErrorCode | null {
    if (current === "configure") {
      if (service === "repair" && problemDescription.trim().length < 10) {
        return "repairDetail";
      }
      return null;
    }
    if (current === "schedule") {
      if (!date) return "chooseDate";
      if (!preferredTime) return "chooseTime";
      return null;
    }
    if (current === "address") {
      if (!streetAddress.trim() || !city.trim()) return "addressRequired";
      return null;
    }
    if (current === "contact") {
      if (!name.trim() || !phone.trim()) return "contactRequired";
      return null;
    }
    return null;
  }

  function goNext() {
    const code = validateStep(step);
    if (code) {
      setErrorCode(code);
      return;
    }
    clearError();
    setStepIndex((value) => Math.min(STEPS.length - 1, value + 1));
  }

  function goBack() {
    clearError();
    setStepIndex((value) => Math.max(0, value - 1));
  }

  async function uploadOneRepairPhoto(itemId: string, file: File) {
    updateRepairPhoto(itemId, {
      status: "uploading",
      error: undefined,
      file,
      path: undefined,
    });
    try {
      const draft = await ensureDraft();
      const body = new FormData();
      body.set("draftToken", draft.draftToken);
      body.set("file", file);
      const response = await fetch("/api/order/photos", {
        method: "POST",
        body,
      });
      const data = (await response.json()) as {
        ok?: boolean;
        path?: string;
        error?: string;
      };
      if (!response.ok || !data.ok || !data.path) {
        throw new Error(data.error || t("errors.photoUploadFailed"));
      }
      updateRepairPhoto(itemId, {
        status: "uploaded",
        path: data.path,
        error: undefined,
        file: undefined,
      });
      setAllowWithoutPhotos(false);
    } catch (uploadError) {
      updateRepairPhoto(itemId, {
        status: "failed",
        error:
          uploadError instanceof Error
            ? uploadError.message
            : t("errors.photoUploadFailed"),
        file,
        path: undefined,
      });
    }
  }

  async function onUploadPhotos(fileList: FileList | null) {
    if (!fileList?.length) {
      setErrorCode("noPhotoSelected");
      return;
    }

    const replaceId = replaceTargetIdRef.current;
    replaceTargetIdRef.current = null;
    setReplaceTargetId(null);

    if (replaceId) {
      const file = fileList[0];
      if (!file) {
        setErrorCode("noPhotoReplace");
        return;
      }
      if (!isAcceptedPhotoFile(file)) {
        setErrorCode("photoType");
        return;
      }
      if (file.size <= 0 || file.size > 5 * 1024 * 1024) {
        setErrorCode("photoSize");
        return;
      }
      clearError();
      const previewUrl = URL.createObjectURL(file);
      setRepairPhotos((prev) => {
        const existing = prev.find((item) => item.id === replaceId);
        if (existing) revokePreview(existing.previewUrl);
        return prev.map((item) =>
          item.id === replaceId
            ? {
                id: replaceId,
                fileName: file.name || "photo",
                status: "uploading" as const,
                file,
                previewUrl,
              }
            : item,
        );
      });
      await uploadOneRepairPhoto(replaceId, file);
      return;
    }

    const remaining = 5 - occupiedPhotoSlots;
    if (remaining <= 0) {
      setErrorCode("maxPhotos");
      return;
    }

    clearError();
    const selected = Array.from(fileList).slice(0, remaining);
    const accepted: File[] = [];
    for (const file of selected) {
      if (!isAcceptedPhotoFile(file)) {
        setErrorCode("photoType");
        continue;
      }
      if (file.size <= 0 || file.size > 5 * 1024 * 1024) {
        setErrorCode("photoSize");
        continue;
      }
      accepted.push(file);
    }
    if (!accepted.length) return;

    const items: RepairPhotoItem[] = accepted.map((file) => ({
      id: crypto.randomUUID(),
      fileName: file.name || "photo",
      status: "uploading" as const,
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setRepairPhotos((prev) => [...prev, ...items]);

    for (const item of items) {
      if (!item.file) continue;
      await uploadOneRepairPhoto(item.id, item.file);
    }
  }

  async function retryRepairPhoto(item: RepairPhotoItem) {
    if (!item.file) {
      setErrorCode("retryChooseAgain");
      return;
    }
    clearError();
    await uploadOneRepairPhoto(item.id, item.file);
  }

  function openPhotoPicker(replaceId?: string) {
    const next = replaceId ?? null;
    replaceTargetIdRef.current = next;
    setReplaceTargetId(next);
    // Allow React to apply `multiple`/disabled before the OS picker opens.
    queueMicrotask(() => fileInputRef.current?.click());
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || successRef || hasUploadingPhotos) return;

    for (const id of STEPS) {
      const code = validateStep(id);
      if (code) {
        setErrorCode(code);
        setStepIndex(STEPS.indexOf(id));
        return;
      }
    }

    if (service === "repair" && hasFailedPhotos) {
      setErrorCode("fixFailedPhotos");
      setStepIndex(STEPS.indexOf("configure"));
      return;
    }

    if (service === "repair" && uploadedPhotoCount === 0 && !allowWithoutPhotos) {
      setErrorCode("photosOrConfirm");
      return;
    }

    if (!turnstileToken) {
      setErrorCode("turnstileRequired");
      return;
    }

    setSending(true);
    clearError();

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
          setErrorCode("badJson");
          return;
        }
      } else if (rawText.trim()) {
        if (response.ok) setErrorCode("notJson");
        else setErrorCode("serverStatus", { status: response.status });
        return;
      } else {
        setErrorCode("emptyResponse", { status: response.status });
        return;
      }

      if (!response.ok || !data.ok || !data.id || !data.orderRef) {
        if (data.error) setRawError(data.error);
        else setErrorCode("saveFailed");
        return;
      }
      setSuccessRef(data.orderRef);
    } catch (submitError) {
      if (submitError instanceof Error && submitError.message) {
        setRawError(submitError.message);
      } else {
        setErrorCode("submitFailed");
      }
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  const serviceTitle = t(`services.${service}.title`);
  const rateLabel = t(`services.${service}.rateLabel`);
  const stepLabel = t(`steps.${step}`);
  const roomsLabel = t("roomsLabel");
  const errorText =
    error?.kind === "raw"
      ? error.message
      : error?.kind === "code"
        ? t(`errors.${error.code}`, error.values)
        : "";

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
                {t("eyebrow")}
              </p>
              <h2 id={titleId} className="mt-1 font-display text-2xl font-medium text-ink">
                {serviceTitle}
              </h2>
              {massageCategory ? (
                <p className="mt-1 text-sm font-medium text-olive">
                  {tMassage(`categories.${massageCategory.id}.title`)}
                </p>
              ) : null}
              <p className="mt-1 text-sm text-muted">{rateLabel}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <LanguageSwitcher tone="onLight" />
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-10 w-10 items-center justify-center border border-mist bg-white text-ink transition hover:border-olive"
                aria-label={t("close")}
              >
                ×
              </button>
            </div>
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
                {t("stepOf", {
                  current: stepIndex + 1,
                  total: STEPS.length,
                  label: stepLabel,
                })}
              </p>
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
        {successRef ? (
          <div className="space-y-4 px-5 py-8 text-center sm:px-6">
            <p className="text-xs font-medium tracking-[0.18em] text-gold uppercase">
              {t("successEyebrow")}
            </p>
            <p className="font-display text-3xl font-medium text-ink">{t("thankYou")}</p>
            <p className="text-sm leading-relaxed text-muted">
              {t.rich("successBody", {
                orderRef: successRef,
                ref: (chunks) => (
                  <span className="font-semibold text-olive">{chunks}</span>
                ),
              })}
            </p>
            {service === "repair" ? (
              <p className="text-sm text-muted">{t("successRepairNote")}</p>
            ) : (
              <p className="text-sm text-muted">
                {t("successEstimatedTotal", { total: formatEuro(total ?? 0) })}
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-full bg-olive px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-olive-deep"
            >
              {t("close")}
            </button>
          </div>
        ) : (
          <form className="space-y-6 px-5 py-5 sm:px-6 sm:py-6" noValidate onSubmit={onSubmit}>
            {!lockService && step === "configure" ? (
              <div className="grid grid-cols-3 gap-2">
                {SERVICES.map((value) => (
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
                    {t(`services.${value}.title`)}
                  </button>
                ))}
              </div>
            ) : null}

            {step === "configure" && service !== "repair" ? (
              <div className="rounded-xl border border-mist bg-white px-5 py-6 text-center">
                <p className="text-xs font-medium tracking-[0.18em] text-muted uppercase">
                  {t("total")}
                </p>
                <p className="mt-2 font-display text-5xl font-bold tracking-tight text-olive sm:text-6xl">
                  {formatEuro(total ?? 0)}
                </p>
              </div>
            ) : null}

            {step === "configure" && service === "repair" ? (
              <div className="rounded-xl border border-sand bg-sand/70 px-4 py-3 text-sm leading-relaxed text-ink">
                <p className="font-medium">{t("quoteBannerTitle")}</p>
                <p className="mt-1 text-olive/80">{t("quoteBannerBody")}</p>
              </div>
            ) : null}

            {step === "configure" && service === "cleaning" ? (
              <div className="space-y-4">
                <Stepper
                  id="cleaning-rooms"
                  label={roomsLabel}
                  value={rooms}
                  min={1}
                  max={6}
                  onChange={setRooms}
                  decreaseLabel={t("decrease", { label: roomsLabel })}
                  increaseLabel={t("increase", { label: roomsLabel })}
                />
                  <div className="rounded-xl border border-sand bg-sand/70 px-4 py-3 text-sm leading-relaxed text-ink">
                  <p className="font-medium">
                    {t("cleaningPlan", {
                      rooms: t("roomCount", { count: rooms }),
                      hours: t("hourCount", { count: cleaning.hours }),
                      cleaners: t("cleanerCount", { count: cleaning.workers }),
                    })}
                  </p>
                  <p className="mt-1 text-olive/80">
                    {t("cleaningFormula", {
                      hours: cleaning.hours,
                      workers: cleaning.workers,
                      total: formatEuro(total ?? 0),
                    })}
                  </p>
                </div>
              </div>
            ) : null}

            {step === "configure" && service === "massage" ? (
              <div>
                <p className="mb-2 text-sm font-medium text-ink">{t("sessionDuration")}</p>
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
                        <span className="font-medium">
                          {t("minutes", { count: option.minutes })}
                        </span>
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
                <Field id="repair-problem" label={t("problemLabel")}>
                  <textarea
                    id="repair-problem"
                    rows={5}
                    maxLength={2000}
                    value={problemDescription}
                    onChange={(event) => setProblemDescription(event.target.value)}
                    placeholder={t("problemPlaceholder")}
                    className={inputClass}
                  />
                </Field>
                <div>
                  <p className="mb-2 text-sm font-medium text-ink">{t("photosLabel")}</p>
                  <p className="mb-2 text-xs text-muted">{t("photosHint")}</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={PHOTO_ACCEPT}
                    multiple={!replaceTargetId}
                    disabled={
                      hasUploadingPhotos ||
                      (occupiedPhotoSlots >= 5 && !replaceTargetId)
                    }
                    onChange={(event) => {
                      void onUploadPhotos(event.target.files);
                      // Clear native value so Android/desktop can re-select the same files.
                      // Selected photos are shown via thumbnails below, not via this label.
                      event.target.value = "";
                    }}
                    className="sr-only"
                    aria-label={t("choosePhotosAria")}
                  />
                  <button
                    type="button"
                    disabled={hasUploadingPhotos || occupiedPhotoSlots >= 5}
                    onClick={() => openPhotoPicker()}
                    className="inline-flex items-center border border-mist bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:border-olive disabled:opacity-50"
                  >
                    {occupiedPhotoSlots > 0 ? t("addMorePhotos") : t("choosePhotos")}
                  </button>
                  {repairPhotos.length ? (
                    <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {repairPhotos.map((item) => (
                        <li
                          key={item.id}
                          className="overflow-hidden border border-mist bg-white"
                        >
                          <div className="relative aspect-square bg-mist/40">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={item.previewUrl}
                              alt={item.fileName}
                              className="h-full w-full object-cover"
                            />
                            <span
                              className={`absolute bottom-0 left-0 right-0 px-2 py-1 text-[11px] font-semibold ${
                                item.status === "uploaded"
                                  ? "bg-olive text-white"
                                  : item.status === "failed"
                                    ? "bg-danger text-white"
                                    : "bg-ink/70 text-white"
                              }`}
                            >
                              {item.status === "uploading"
                                ? t("uploading")
                                : item.status === "uploaded"
                                  ? t("uploaded")
                                  : t("failed")}
                            </span>
                          </div>
                          <div className="space-y-1 p-2">
                            <p className="truncate text-xs text-ink">{item.fileName}</p>
                            {item.status === "failed" && item.error ? (
                              <p className="text-xs text-danger">{item.error}</p>
                            ) : null}
                            <div className="flex flex-wrap gap-1">
                              {item.status === "failed" ? (
                                <button
                                  type="button"
                                  onClick={() => void retryRepairPhoto(item)}
                                  disabled={hasUploadingPhotos}
                                  className="border border-mist px-2 py-1 text-[11px] font-semibold text-ink disabled:opacity-50"
                                >
                                  {t("retry")}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => openPhotoPicker(item.id)}
                                disabled={hasUploadingPhotos}
                                className="border border-mist px-2 py-1 text-[11px] font-semibold text-ink disabled:opacity-50"
                              >
                                {t("replace")}
                              </button>
                              <button
                                type="button"
                                onClick={() => removeRepairPhoto(item.id)}
                                disabled={hasUploadingPhotos}
                                className="border border-mist px-2 py-1 text-[11px] font-semibold text-ink disabled:opacity-50"
                              >
                                {t("remove")}
                              </button>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-muted">{t("noPhotosYet")}</p>
                  )}
                  <p className="mt-2 text-sm text-olive">
                    {t("confirmedOnServer", { count: uploadedPhotoCount })}
                  </p>
                </div>
              </div>
            ) : null}

            {step === "schedule" ? (
              <div className="space-y-4">
                <Field id="order-date" label={t("preferredDate")}>
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
                    {t("preferredTime")}
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
                              ? t("timeSelected", { slot })
                              : t("timeOption", { slot })
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
                    {t("timeHint", { time: preferredTime })}
                  </p>
                </div>
              </div>
            ) : null}

            {step === "address" ? (
              <div className="space-y-4">
                <Field id="order-street" label={t("streetLabel")}>
                  <input
                    id="order-street"
                    type="text"
                    autoComplete="street-address"
                    value={streetAddress}
                    onChange={(event) => setStreetAddress(event.target.value)}
                    className={inputClass}
                    placeholder={t("streetPlaceholder")}
                  />
                </Field>
                <Field id="order-city" label={t("cityLabel")}>
                  <input
                    id="order-city"
                    type="text"
                    autoComplete="address-level2"
                    value={city}
                    onChange={(event) => setCity(event.target.value)}
                    className={inputClass}
                    placeholder={t("cityPlaceholder")}
                  />
                </Field>
                <Field id="order-floor" label={t("floorLabel")}>
                  <input
                    id="order-floor"
                    type="text"
                    value={apartmentFloor}
                    onChange={(event) => setApartmentFloor(event.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field id="order-access" label={t("accessLabel")}>
                  <textarea
                    id="order-access"
                    rows={3}
                    value={accessInstructions}
                    onChange={(event) => setAccessInstructions(event.target.value)}
                    className={inputClass}
                    placeholder={t("accessPlaceholder")}
                  />
                </Field>
              </div>
            ) : null}

            {step === "contact" ? (
              <div className="space-y-4">
                <Field id="order-name" label={t("nameLabel")}>
                  <input
                    id="order-name"
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className={inputClass}
                    placeholder={t("namePlaceholder")}
                  />
                </Field>
                <Field id="order-phone" label={t("phoneLabel")}>
                  <input
                    id="order-phone"
                    type="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    className={inputClass}
                    placeholder={t("phonePlaceholder")}
                  />
                </Field>
              </div>
            ) : null}

            {step === "review" ? (
              <div className="space-y-4 text-sm leading-relaxed text-ink">
                <div className="rounded-xl border border-mist bg-white px-4 py-4">
                  <p className="text-xs tracking-[0.14em] text-muted uppercase">
                    {t("summary")}
                  </p>
                  <p className="mt-2 font-display text-xl text-ink">{serviceTitle}</p>
                  {massageCategory ? (
                    <p className="mt-1 text-olive">
                      {tMassage(`categories.${massageCategory.id}.title`)}
                    </p>
                  ) : null}
                  {service === "cleaning" ? (
                    <p className="mt-2">
                      {t("cleaningSummary", {
                        rooms: t("roomCount", { count: rooms }),
                        hours: cleaning.hours,
                        cleaners: t("cleanerCount", { count: cleaning.workers }),
                        total: formatEuro(total ?? 0),
                      })}
                    </p>
                  ) : null}
                  {service === "massage" ? (
                    <p className="mt-2">
                      {t("massageSummary", {
                        minutes: massageMinutes,
                        total: formatEuro(total ?? 0),
                      })}
                    </p>
                  ) : null}
                  {service === "repair" ? (
                    <div className="mt-2 space-y-2">
                      <p>{t("repairSummary", { count: uploadedPhotoCount })}</p>
                      {hasFailedPhotos ? (
                        <p className="text-danger">
                          {t("photosFailedReview", { count: failedPhotoCount })}
                        </p>
                      ) : null}
                      {uploadedPhotoCount === 0 ? (
                        <label className="flex items-start gap-2 text-ink">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={allowWithoutPhotos}
                            onChange={(event) =>
                              setAllowWithoutPhotos(event.target.checked)
                            }
                          />
                          <span>{t("sendWithoutPhotos")}</span>
                        </label>
                      ) : null}
                    </div>
                  ) : null}
                  <p className="mt-2">{t("atTime", { date, time: preferredTime })}</p>
                  <p className="mt-1">
                    {[streetAddress, apartmentFloor, city].filter(Boolean).join(", ")}
                  </p>
                  <p className="mt-1">
                    {name} · {phone}
                  </p>
                </div>
              </div>
            ) : null}

            {errorText ? (
              <p className="text-sm font-medium text-danger" role="alert">
                {errorText}
              </p>
            ) : null}

            <div className="sticky bottom-0 -mx-5 mt-2 border-t border-mist bg-paper/95 px-5 py-4 backdrop-blur sm:-mx-6 sm:px-6">
              {step === "review" && !successRef ? (
                <div className="mb-3">
                  <p className="mb-2 text-xs font-medium tracking-[0.14em] text-muted uppercase">
                    {t("securityTitle")}
                  </p>
                  <p className="mb-2 text-xs text-muted">{t("securityHint")}</p>
                  <TurnstileWidget
                    key={turnstileKey}
                    onToken={setTurnstileToken}
                  />
                </div>
              ) : null}
              <div className="flex gap-2">
                {stepIndex > 0 ? (
                  <button
                    type="button"
                    onClick={goBack}
                    className="flex-1 border border-mist bg-white px-4 py-3.5 text-sm font-semibold text-ink transition hover:border-olive"
                  >
                    {t("back")}
                  </button>
                ) : null}
                {step !== "review" ? (
                  <button
                    type="button"
                    onClick={goNext}
                    disabled={hasUploadingPhotos}
                    className="flex-1 bg-olive px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-olive-deep disabled:opacity-60"
                  >
                    {t("continue")}
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={
                      sending ||
                      hasUploadingPhotos ||
                      (service === "repair" && hasFailedPhotos) ||
                      (service === "repair" &&
                        uploadedPhotoCount === 0 &&
                        !allowWithoutPhotos)
                    }
                    className="flex-1 bg-olive px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-olive-deep disabled:opacity-60"
                  >
                    {sending
                      ? t("sending")
                      : service === "repair"
                        ? t("requestQuote")
                        : t("confirmPrice", { price: formatEuro(total ?? 0) })}
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
