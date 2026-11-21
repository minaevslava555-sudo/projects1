"use client";

import LanguageSwitcher from "@/components/language-switcher";
import TurnstileWidget from "@/components/turnstile-widget";
import {
  buildBookingAttemptFingerprint,
  clearBookingAttempt,
  readBookingAttempt,
  writeBookingAttempt,
} from "@/lib/booking-attempt";
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
import { motion, useReducedMotion } from "motion/react";
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

const BOOKING_EASE = [0.22, 1, 0.36, 1] as const;
const BACKDROP_MS = 0.22;
const PANEL_DESKTOP_MS = 0.28;
const PANEL_MOBILE_MS = 0.3;

function getDialogFocusable(container: HTMLElement): HTMLElement[] {
  const nodes = [
    ...container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ];
  return nodes.filter((el) => {
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (el.tabIndex < 0) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    // Keep sr-only file inputs; skip zero-size non-inputs.
    if (el.tagName !== "INPUT" && el.offsetParent === null && style.position !== "fixed") {
      return false;
    }
    return true;
  });
}

/** True when programmatic focus would land on a real, visible page control. */
function isElementInteractivelyFocusable(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  if (el.closest("[data-booking-overlay='true']")) return false;
  if (el.closest("[inert]")) return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  // Outgoing / inactive crossfade layers are not interactive targets.
  if (el.closest(".view-layer-out")) return false;
  const incoming = el.closest(".view-layer-in");
  if (incoming && !incoming.classList.contains("is-active")) return false;

  let node: HTMLElement | null = el;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (style.pointerEvents === "none") return false;
    if (Number.parseFloat(style.opacity) < 0.05) return false;
    node = node.parentElement;
  }

  const rect = el.getBoundingClientRect();
  return rect.width >= 1 && rect.height >= 1;
}

function controlAccessibleName(el: HTMLElement): string {
  return (el.getAttribute("aria-label") || el.textContent || "").trim();
}

/**
 * Prefer the exact opener when still interactive; otherwise a same-named
 * control in the active view, then a visible booking CTA, then header Book.
 */
function resolveBookingFocusTarget(
  opener: HTMLElement | null,
  openerNameHint = "",
): HTMLElement | null {
  if (opener && isElementInteractivelyFocusable(opener)) return opener;

  const landing = document.querySelector(".havenly-landing");
  if (!(landing instanceof HTMLElement)) return null;

  const activeScope =
    landing.querySelector(".view-layer-in.is-active") ??
    landing.querySelector("main") ??
    landing;

  const candidates = [
    ...activeScope.querySelectorAll<HTMLElement>("button, a[href], [role='button']"),
  ].filter((el) => !el.closest(".view-layer-out"));

  const openerName =
    openerNameHint || (opener ? controlAccessibleName(opener) : "");
  if (openerName) {
    const sameName = candidates.find(
      (el) =>
        controlAccessibleName(el) === openerName &&
        isElementInteractivelyFocusable(el),
    );
    if (sameName) return sameName;
  }

  // Prefer primary service booking CTAs over generic "Book this service".
  const ranked = candidates.filter((el) => {
    if (!isElementInteractivelyFocusable(el)) return false;
    return /book|reservar|reserve/i.test(controlAccessibleName(el));
  });
  const specific = ranked.find((el) =>
    /book (cleaning|repairs|massage)|reservar (limpeza|repara|massagem)/i.test(
      controlAccessibleName(el),
    ),
  );
  if (specific) return specific;
  if (ranked[0]) return ranked[0];

  const headerBook = [
    ...landing.querySelectorAll<HTMLElement>("header button"),
  ].find(
    (el) =>
      /book|reservar|reserve/i.test(controlAccessibleName(el)) &&
      isElementInteractivelyFocusable(el),
  );
  return headerBook ?? null;
}

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
  | "chooseRooms"
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
  | "submitFailed"
  | "orderProcessing"
  | "temporaryUnavailable"
  | "tooManyRequests"
  | "attemptPayloadChanged";

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
          className="havenly-control inline-flex h-11 w-11 items-center justify-center border border-mist bg-white text-lg text-ink transition hover:border-olive disabled:opacity-40"
        >
          −
        </button>
        <input
          id={id}
          type="number"
          readOnly
          value={value}
          className="havenly-control w-full border border-mist bg-white px-4 py-3 text-center text-ink outline-none"
        />
        <button
          type="button"
          aria-label={increaseLabel}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          className="havenly-control inline-flex h-11 w-11 items-center justify-center border border-mist bg-white text-lg text-ink transition hover:border-olive disabled:opacity-40"
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
  "havenly-control w-full border border-mist bg-white px-4 py-3 text-ink outline-none transition placeholder:text-muted/60 focus:border-olive";

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
  const reduceMotion = useReducedMotion();
  const reducedMotion = !!reduceMotion;
  const [stepIndex, setStepIndex] = useState(0);
  const [rooms, setRooms] = useState<number | null>(null);
  const [massageMinutes, setMassageMinutes] = useState<MassageMinutes>(60);
  const [problemDescription, setProblemDescription] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftToken, setDraftToken] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => {
    const pending = readBookingAttempt();
    return pending?.idempotencyKey ?? crypto.randomUUID();
  });
  const [hasUnresolvedAttempt, setHasUnresolvedAttempt] = useState(
    () => readBookingAttempt() != null,
  );
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
  const submittingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceTargetIdRef = useRef<string | null>(null);
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);
  /** Overlay stays mounted through exit animation without remounting form state. */
  const [overlayPresent, setOverlayPresent] = useState(open);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(min-width: 640px)").matches
      : false,
  );
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const openerNameRef = useRef("");
  const closingRef = useRef(false);
  const wasOverlayPresentRef = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const step = STEPS[stepIndex] ?? "configure";
  const cleaning = useMemo(
    () => (rooms == null ? null : cleaningPlan(rooms)),
    [rooms],
  );
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
    if (service === "cleaning") {
      return rooms == null ? null : cleaningPriceEuro(rooms);
    }
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

  function resetWizardFields(options?: { preserveAttempt?: boolean }) {
    setStepIndex(0);
    setRooms(null);
    setMassageMinutes(60);
    setProblemDescription("");
    setDraftId(null);
    setDraftToken(null);
    if (!options?.preserveAttempt) {
      clearBookingAttempt();
      setHasUnresolvedAttempt(false);
      setIdempotencyKey(crypto.randomUUID());
    }
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
    submittingRef.current = false;
    clearError();
    setSuccessRef(null);
  }

  function startNewBookingAttempt() {
    clearBookingAttempt();
    setHasUnresolvedAttempt(false);
    resetWizardFields();
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
    if (response.status === 429) {
      throw new Error(t("errors.tooManyRequests"));
    }
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
    const mq = window.matchMedia("(min-width: 640px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Capture the real trigger before React opens the modal (more reliable than
  // reading activeElement after inert/focus moves).
  useEffect(() => {
    if (open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const trigger = target.closest<HTMLElement>(
        "button, a[href], [role='button']",
      );
      if (trigger && !trigger.closest("[data-booking-overlay='true']")) {
        openerRef.current = trigger;
        openerNameRef.current = controlAccessibleName(trigger);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  useEffect(() => {
    if (open) {
      // Re-open mid-exit: cancel teardown and keep the same mounted overlay.
      closingRef.current = false;
      setOverlayPresent(true);
      if (
        !openerRef.current &&
        document.activeElement instanceof HTMLElement &&
        document.activeElement !== document.body
      ) {
        openerRef.current = document.activeElement;
        openerNameRef.current = controlAccessibleName(document.activeElement);
      }
    } else if (overlayPresent) {
      // Soft-close start: drop focus from the dialog so exit can finish cleanly.
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        dialogRef.current?.contains(active)
      ) {
        active.blur();
      }
    }
  }, [open, overlayPresent]);

  useEffect(() => {
    if (!overlayPresent) return;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarGap =
      window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarGap > 0) {
      document.body.style.paddingRight = `${scrollbarGap}px`;
    }

    const root = document.querySelector(".havenly-landing");
    const inerted: HTMLElement[] = [];
    if (root) {
      for (const child of Array.from(root.children)) {
        if (!(child instanceof HTMLElement)) continue;
        if (child.dataset.bookingOverlay === "true") continue;
        child.inert = true;
        inerted.push(child);
      }
    }

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      for (const el of inerted) el.inert = false;
    };
  }, [overlayPresent]);

  function focusCloseControl() {
    closeButtonRef.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!open) return;
    // Wait for mount / interrupted re-enter paint before moving focus.
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(focusCloseControl);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  // Keyboard + focus trap only while truly open (not during exit).
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;

      // Let the browser move focus into iframes (Turnstile); only cycle when
      // focus is on an in-document control at the ends of the dialog.
      const active = document.activeElement;
      if (active instanceof HTMLIFrameElement && dialog.contains(active)) {
        return;
      }
      if (!(active instanceof HTMLElement) || !dialog.contains(active)) {
        return;
      }

      const focusable = getDialogFocusable(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    const onFocusIn = (event: FocusEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (dialog.contains(target)) return;
      const focusable = getDialogFocusable(dialog);
      (focusable[0] ?? dialog).focus({ preventScroll: true });
    };

    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open]);

  function requestClose() {
    if (closingRef.current || !openRef.current) return;
    closingRef.current = true;
    onCloseRef.current();
  }

  // Native backdrop listener — more reliable than Motion/React synthetic clicks.
  useEffect(() => {
    if (!open) return;
    const node = backdropRef.current;
    if (!node) return;
    const onClick = () => requestClose();
    node.addEventListener("click", onClick);
    return () => node.removeEventListener("click", onClick);
  }, [open]);

  function finishCloseAnimation() {
    // Interrupted exit (re-opened): stay mounted; do not clear chrome.
    if (openRef.current) {
      closingRef.current = false;
      return;
    }
    setOverlayPresent(false);
    closingRef.current = false;
  }

  // Safety net if Motion skips onAnimationComplete after interrupted cycles.
  useEffect(() => {
    if (open || !overlayPresent) return;
    const durationMs =
      (reducedMotion
        ? 0.05
        : isDesktop
          ? PANEL_DESKTOP_MS
          : PANEL_MOBILE_MS) *
        1000 +
      100;
    const timer = window.setTimeout(() => {
      if (!openRef.current) finishCloseAnimation();
    }, durationMs);
    return () => window.clearTimeout(timer);
  }, [open, overlayPresent, isDesktop, reducedMotion]);

  // Restore focus only after overlayPresent flips false so inert siblings are
  // cleared first (focus into an inert ancestor is ignored by the browser).
  useEffect(() => {
    if (overlayPresent) {
      wasOverlayPresentRef.current = true;
      return;
    }
    if (!wasOverlayPresentRef.current) return;
    wasOverlayPresentRef.current = false;
    const opener = openerRef.current;
    const openerName = openerNameRef.current;
    openerRef.current = null;
    openerNameRef.current = "";
    const target = resolveBookingFocusTarget(opener, openerName);
    target?.focus({ preventScroll: true });
  }, [overlayPresent]);

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
        if (response.status === 429) {
          setErrorCode("tooManyRequests");
          return;
        }
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
      if (service === "cleaning" && rooms == null) {
        return "chooseRooms";
      }
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
    if (submittingRef.current || sending || successRef || hasUploadingPhotos) {
      return;
    }

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

    if (service === "cleaning" && rooms == null) {
      setErrorCode("chooseRooms");
      setStepIndex(STEPS.indexOf("configure"));
      return;
    }

    submittingRef.current = true;
    setSending(true);
    clearError();

    try {
      const massageCategoryValue =
        service === "massage"
          ? massageCategory?.title || massageCategoryId || null
          : null;
      const fingerprint = await buildBookingAttemptFingerprint({
        name: name.trim(),
        phone: phone.trim(),
        service,
        date,
        preferredTime,
        streetAddress: streetAddress.trim(),
        city: city.trim(),
        apartmentFloor: apartmentFloor.trim() || null,
        accessInstructions: accessInstructions.trim() || null,
        details: null,
        problemDescription:
          service === "repair" ? problemDescription.trim() : null,
        massageCategory: massageCategoryValue,
        rooms: service === "cleaning" ? rooms : null,
        massageMinutes: service === "massage" ? massageMinutes : null,
        repairPhotoPaths: service === "repair" ? repairPhotoPaths : null,
      });

      const persisted = readBookingAttempt();
      if (persisted && persisted.fingerprint !== fingerprint) {
        setErrorCode("attemptPayloadChanged");
        setHasUnresolvedAttempt(true);
        return;
      }

      const keyToUse =
        persisted && persisted.fingerprint === fingerprint
          ? persisted.idempotencyKey
          : idempotencyKey;
      if (keyToUse !== idempotencyKey) {
        setIdempotencyKey(keyToUse);
      }

      writeBookingAttempt({
        idempotencyKey: keyToUse,
        fingerprint,
        service,
      });
      setHasUnresolvedAttempt(true);

      const draft = await ensureDraft();
      const response = await fetch("/api/order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": keyToUse,
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
          massageCategory: massageCategoryValue || undefined,
          problemDescription:
            service === "repair" ? problemDescription.trim() : undefined,
          repairPhotoPaths: service === "repair" ? repairPhotoPaths : undefined,
          draftToken: draft.draftToken,
          turnstileToken,
          idempotencyKey: keyToUse,
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
        if (response.status === 503) {
          setErrorCode("temporaryUnavailable");
          return;
        }
        if (response.status === 409) {
          setErrorCode("orderProcessing");
          return;
        }
        if (response.status === 429) {
          setErrorCode("tooManyRequests");
          return;
        }
        if (data.error) setRawError(data.error);
        else setErrorCode("saveFailed");
        return;
      }

      clearBookingAttempt();
      setHasUnresolvedAttempt(false);
      setSuccessRef(data.orderRef);
    } catch (submitError) {
      // Keep persisted attempt — network failure may mean the order already landed.
      if (submitError instanceof Error && submitError.message) {
        setRawError(submitError.message);
      } else {
        setErrorCode("submitFailed");
      }
    } finally {
      submittingRef.current = false;
      setSending(false);
    }
  }

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

  const panelDuration = reducedMotion
    ? 0.01
    : isDesktop
      ? PANEL_DESKTOP_MS
      : PANEL_MOBILE_MS;
  const backdropDuration = reducedMotion ? 0.01 : BACKDROP_MS;

  const panelOpenState = reducedMotion
    ? { opacity: 1 }
    : { opacity: 1, y: 0 };
  const panelClosedState = reducedMotion
    ? { opacity: 0 }
    : isDesktop
      ? { opacity: 0, y: 10 }
      : { opacity: 1, y: "100%" };

  if (!overlayPresent) return null;

  return (
    <div
      data-booking-overlay="true"
      data-booking-closing={open ? undefined : "true"}
      className="booking-overlay fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
      role="presentation"
      aria-hidden={open ? undefined : true}
    >
      <motion.div
        ref={backdropRef}
        aria-hidden="true"
        className="booking-overlay-backdrop absolute inset-0 bg-ink/55"
        initial={{ opacity: 0 }}
        animate={{ opacity: open ? 1 : 0 }}
        transition={{ duration: backdropDuration, ease: BOOKING_EASE }}
      />
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="booking-overlay-panel havenly-control relative z-10 flex max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden border border-mist bg-paper shadow-2xl sm:max-h-[90svh]"
        initial={panelClosedState}
        animate={open ? panelOpenState : panelClosedState}
        transition={{ duration: panelDuration, ease: BOOKING_EASE }}
        onAnimationComplete={() => {
          if (openRef.current) {
            focusCloseControl();
            return;
          }
          finishCloseAnimation();
        }}
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
                ref={closeButtonRef}
                type="button"
                onClick={requestClose}
                className="havenly-control inline-flex h-10 w-10 items-center justify-center border border-mist bg-white text-ink transition hover:border-olive"
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

          {hasUnresolvedAttempt && !successRef && !sending ? (
            <div
              className="mt-4 border border-gold/40 bg-gold/10 px-3 py-3 text-left"
              role="status"
            >
              <p className="text-sm text-ink">{t("unresolvedAttemptBody")}</p>
              <button
                type="button"
                onClick={startNewBookingAttempt}
                className="mt-2 text-sm font-semibold text-olive underline-offset-2 hover:underline"
              >
                {t("startNewBooking")}
              </button>
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
              onClick={requestClose}
              className="havenly-control w-full bg-olive px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-olive-deep"
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
                    className={`havenly-control px-2 py-2.5 text-xs font-semibold transition sm:text-sm ${
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

            {step === "configure" && service === "massage" ? (
              <div className="rounded-xl border border-mist bg-white px-5 py-6 text-center">
                <p className="text-xs font-medium tracking-[0.18em] text-muted uppercase">
                  {t("total")}
                </p>
                <p className="mt-2 font-display text-5xl font-bold tracking-tight text-olive sm:text-6xl">
                  {formatEuro(total ?? 0)}
                </p>
              </div>
            ) : null}

            {step === "configure" && service === "cleaning" && total != null ? (
              <div className="rounded-xl border border-mist bg-white px-5 py-6 text-center">
                <p className="text-xs font-medium tracking-[0.18em] text-muted uppercase">
                  {t("total")}
                </p>
                <p className="mt-2 font-display text-5xl font-bold tracking-tight text-olive sm:text-6xl">
                  {formatEuro(total)}
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
                {rooms == null ? (
                  <div>
                    <p className="mb-2 block text-sm font-medium text-ink">
                      {roomsLabel}
                    </p>
                    <p className="mb-3 text-sm leading-relaxed text-muted">
                      {t("chooseRoomsHint")}
                    </p>
                    <div
                      className="grid grid-cols-3 gap-2 sm:grid-cols-6"
                      role="group"
                      aria-label={roomsLabel}
                    >
                      {[1, 2, 3, 4, 5, 6].map((count) => (
                        <button
                          key={count}
                          type="button"
                          onClick={() => {
                            setRooms(count);
                            clearError();
                          }}
                          className="havenly-control border border-mist bg-white px-3 py-3 text-sm font-semibold text-ink transition hover:border-olive"
                        >
                          {count}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
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
                )}
                {rooms != null && cleaning != null && total != null ? (
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
                        total: formatEuro(total),
                      })}
                    </p>
                  </div>
                ) : null}
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
                        className={`havenly-control flex items-center justify-between border px-4 py-3 text-left transition ${
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
                    className="havenly-control inline-flex items-center border border-mist bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:border-olive disabled:opacity-50"
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
                          className={`havenly-control border px-2 py-2.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ${
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
                  {service === "cleaning" &&
                  rooms != null &&
                  cleaning != null &&
                  total != null ? (
                    <p className="mt-2">
                      {t("cleaningSummary", {
                        rooms: t("roomCount", { count: rooms }),
                        hours: cleaning.hours,
                        cleaners: t("cleanerCount", { count: cleaning.workers }),
                        total: formatEuro(total),
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
                    className="havenly-control flex-1 border border-mist bg-white px-4 py-3.5 text-sm font-semibold text-ink transition hover:border-olive"
                  >
                    {t("back")}
                  </button>
                ) : null}
                {step !== "review" ? (
                  <button
                    type="button"
                    onClick={goNext}
                    disabled={
                      hasUploadingPhotos ||
                      (service === "cleaning" && rooms == null && step === "configure")
                    }
                    className="havenly-control flex-1 bg-olive px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-olive-deep disabled:opacity-60"
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
                    className="havenly-control flex-1 bg-olive px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-olive-deep disabled:opacity-60"
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
      </motion.div>
    </div>
  );
}
