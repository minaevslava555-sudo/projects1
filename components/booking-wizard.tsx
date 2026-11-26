"use client";

import LanguageSwitcher from "@/components/language-switcher";
import TurnstileWidget from "@/components/turnstile-widget";
import WellnessEquipmentModal from "@/components/wellness-equipment-modal";
import {
  buildBookingAttemptFingerprint,
  clearBookingAttempt,
  isBookingAttemptQuoteStale,
  readBookingAttempt,
  writeBookingAttempt,
} from "@/lib/booking-attempt";
import {
  CLEANING_V1_ADDON_KEYS,
  CLEANING_V1_ADDON_MINUTES,
  CLEANING_V1_HOURLY_RATE_EURO,
  CLEANING_V1_MAX_ROOMS_PER_TYPE,
  CLEANING_V1_MIN_PRICE_EURO,
  CLEANING_V1_QUOTE_REVISION,
  cleaningV1CleaningTypeMultiplier,
  cleaningV1CustomerPriceDeltaEuro,
  clampCleaningV1ExtraRoomsForPreset,
  cleaningV1MaxAddonCount,
  cleaningV1RoomUnitMinutes,
  CLEANING_V1_PRESETS,
  CLEANING_V1_ROOM_KEYS,
  EMPTY_CLEANING_V1_ADDONS,
  EMPTY_CLEANING_V1_ROOMS,
  MASSAGE_OPTIONS,
  buildTimeSlots,
  calculateCleaningV1Price,
  cleaningPlan,
  cleaningPriceEuro,
  cleaningV1AddonsHaveWork,
  formatEuro,
  massagePriceEuro,
  type BookingService,
  type CleaningV1AddonCounts,
  type CleaningV1AddonId,
  type CleaningV1PresetId,
  type CleaningV1PriceResult,
  type CleaningV1RoomCounts,
  type CleaningV1Type,
  type MassageMinutes,
} from "@/lib/booking-pricing";
import {
  getMassageCategory,
  type MassageCategoryId,
} from "@/lib/massage-catalog";
import {
  MASSAGE_V1_QUOTE_REVISION,
  MASSAGE_V1_TARIFFS,
  WELLNESS_EQUIPMENT,
  WELLNESS_EQUIPMENT_IDS,
  centsToEuro,
  type MassageV1TariffId,
  type WellnessEquipmentId,
} from "@/lib/massage-wellness-catalog";
import { calculateMassageV1Price } from "@/lib/massage-wellness-pricing";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import {
  useEffect,
  useId,
  useLayoutEffect,
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
const STEP_MS = 0.24;
const STEP_OFFSET_X = 10;
/** Shrink stage min-height a bit faster than the crossfade to limit empty space. */
const STAGE_SHRINK_MS = 0.16;

type PendingStepNav = "back" | "next" | { index: number };

function isBookingTextField(el: EventTarget | null): el is HTMLElement {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

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
  | "attemptPayloadChanged"
  | "estimateRevised"
  | "cleaningV1Incomplete"
  | "cleaningV1PreviewOnly"
  | "massageV1Incomplete"
  | "massageV1PreviewOnly";

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

/** Client Preview gate — default off; independent of server CLEANING_V1_ORDERS_ENABLED. */
const CLEANING_V1_BOOKING_ENABLED =
  process.env.NEXT_PUBLIC_CLEANING_V1_BOOKING_ENABLED === "true";

/**
 * Client submit gate — set together with server CLEANING_V1_ORDERS_ENABLED.
 * When booking UI is on but this is off, show preview-only and block Confirm.
 */
const CLEANING_V1_ORDERS_CLIENT_ENABLED =
  process.env.NEXT_PUBLIC_CLEANING_V1_ORDERS_ENABLED === "true";

/** Client Preview gate for Massage & Wellness v1 UI. Default off. */
const MASSAGE_V1_UI_ENABLED =
  process.env.NEXT_PUBLIC_MASSAGE_V1_UI_ENABLED === "true";

/** Client submit gate — pair with server MASSAGE_V1_ORDERS_ENABLED. */
const MASSAGE_V1_ORDERS_CLIENT_ENABLED =
  process.env.NEXT_PUBLIC_MASSAGE_V1_ORDERS_ENABLED === "true";

const MASSAGE_V1_EQUIPMENT_UI_BOOKABLE =
  process.env.NEXT_PUBLIC_MASSAGE_V1_EQUIPMENT_BOOKABLE === "true";

const MASSAGE_V1_PREMIUM_UI_BOOKABLE =
  process.env.NEXT_PUBLIC_MASSAGE_V1_PREMIUM_WELLNESS_BOOKABLE === "true";

const CLEANING_V1_PRESET_IDS: CleaningV1PresetId[] = ["t1", "t2", "t3"];

const MASSAGE_V1_PRIMARY_TARIFFS: MassageV1TariffId[] = [
  "relaxing-60",
  "sports-60",
  "targeted-60",
  "premium-wellness-120",
];

const CLEANING_V1_TYPES: CleaningV1Type[] = [
  "standard",
  "deep",
  "post_renovation",
];

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

function mergeCleaningV1BaseAndExtra(
  base: CleaningV1RoomCounts,
  extra: CleaningV1RoomCounts,
): CleaningV1RoomCounts {
  const merged = { ...EMPTY_CLEANING_V1_ROOMS };
  for (const key of CLEANING_V1_ROOM_KEYS) {
    merged[key] = Math.min(
      CLEANING_V1_MAX_ROOMS_PER_TYPE,
      base[key] + extra[key],
    );
  }
  return merged;
}

export default function BookingWizard({
  open,
  service,
  onServiceChange,
  onClose,
  lockService = false,
  massageCategoryId = null,
  initialMassageTariffId = null,
}: {
  open: boolean;
  service: BookingService;
  onServiceChange: (service: BookingService) => void;
  onClose: () => void;
  lockService?: boolean;
  massageCategoryId?: MassageCategoryId | null;
  initialMassageTariffId?: MassageV1TariffId | null;
}) {
  const t = useTranslations("BookingWizard");
  const tMassage = useTranslations("MassageCatalog");
  const tEquip = useTranslations("WellnessEquipment");
  const titleId = useId();
  const stepHeadingId = useId();
  const reduceMotion = useReducedMotion();
  const reducedMotion = !!reduceMotion;
  const [stepIndex, setStepIndex] = useState(0);
  const [stepDirection, setStepDirection] = useState(1);
  const [stageHeight, setStageHeight] = useState<number | null>(null);
  const [stageHeightShrinking, setStageHeightShrinking] = useState(false);
  const stepHeadingRef = useRef<HTMLParagraphElement | null>(null);
  const stepPaneRef = useRef<HTMLDivElement | null>(null);
  const bookingScrollRef = useRef<HTMLDivElement | null>(null);
  const skipStepFocusRef = useRef(true);
  const stepTransitionLockRef = useRef(false);
  const pendingStepNavRef = useRef<PendingStepNav | null>(null);
  const stepTransitionGenRef = useRef(0);
  const stageHeightValueRef = useRef<number | null>(null);
  const [rooms, setRooms] = useState<number | null>(null);
  const [roomCounts, setRoomCounts] = useState<CleaningV1RoomCounts>(
    EMPTY_CLEANING_V1_ROOMS,
  );
  /** Extra rooms beyond the selected typical-home preset (server still gets totals). */
  const [extraRoomCounts, setExtraRoomCounts] = useState<CleaningV1RoomCounts>(
    EMPTY_CLEANING_V1_ROOMS,
  );
  const [addonCounts, setAddonCounts] = useState<CleaningV1AddonCounts>(
    EMPTY_CLEANING_V1_ADDONS,
  );
  const [cleaningType, setCleaningType] = useState<CleaningV1Type | null>(null);
  const [activePreset, setActivePreset] = useState<CleaningV1PresetId | null>(
    null,
  );
  const [extraRoomsCapNoticeKeys, setExtraRoomsCapNoticeKeys] = useState<
    Array<keyof CleaningV1RoomCounts>
  >([]);
  const [massageMinutes, setMassageMinutes] = useState<MassageMinutes>(60);
  const [massageTariffId, setMassageTariffId] = useState<MassageV1TariffId | null>(
    () => (MASSAGE_V1_UI_ENABLED ? initialMassageTariffId : null),
  );
  const [wellnessEquipmentIds, setWellnessEquipmentIds] = useState<
    WellnessEquipmentId[]
  >([]);
  const [equipmentModalId, setEquipmentModalId] =
    useState<WellnessEquipmentId | null>(null);
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
  const [estimateNeedsConfirm, setEstimateNeedsConfirm] = useState(() => {
    const pending = readBookingAttempt();
    if (pending == null) return false;
    if (
      CLEANING_V1_BOOKING_ENABLED &&
      pending.service === "cleaning" &&
      isBookingAttemptQuoteStale(pending, CLEANING_V1_QUOTE_REVISION)
    ) {
      return true;
    }
    if (
      MASSAGE_V1_UI_ENABLED &&
      pending.service === "massage" &&
      isBookingAttemptQuoteStale(pending, MASSAGE_V1_QUOTE_REVISION)
    ) {
      return true;
    }
    return false;
  });
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

  const isMassageV1Booking =
    MASSAGE_V1_UI_ENABLED && service === "massage";
  const isMassageV1PreviewOnly =
    isMassageV1Booking && !MASSAGE_V1_ORDERS_CLIENT_ENABLED;
  const isPremiumTariff = massageTariffId === "premium-wellness-120";

  const massageV1Estimate = useMemo(() => {
    if (!isMassageV1Booking || massageTariffId == null) return null;
    if (isPremiumTariff && !MASSAGE_V1_PREMIUM_UI_BOOKABLE) {
      // Still show catalog price for UX preview; submit gated separately.
    }
    const result = calculateMassageV1Price(
      {
        tariffId: massageTariffId,
        ...(wellnessEquipmentIds.length > 0 && !isPremiumTariff
          ? { wellnessEquipmentIds }
          : {}),
      },
      {
        equipmentBookable: true,
        premiumWellnessBookable: true,
      },
    );
    if ("error" in result) return null;
    return result;
  }, [
    isMassageV1Booking,
    massageTariffId,
    wellnessEquipmentIds,
    isPremiumTariff,
  ]);

  const total = useMemo(() => {
    if (isMassageV1Booking) {
      return massageV1Estimate?.priceEuro ?? null;
    }
    if (service === "massage") return massagePriceEuro(massageMinutes) ?? 45;
    if (service === "cleaning") {
      return rooms == null ? null : cleaningPriceEuro(rooms);
    }
    return null;
  }, [
    isMassageV1Booking,
    massageV1Estimate,
    service,
    massageMinutes,
    rooms,
  ]);

  type CleaningV1EstimateView =
    | { status: "incomplete" }
    | { status: "invalid" }
    | { status: "fixed"; result: CleaningV1PriceResult }
    | { status: "quote"; result: CleaningV1PriceResult };

  const cleaningV1Estimate = useMemo((): CleaningV1EstimateView | null => {
    if (!CLEANING_V1_BOOKING_ENABLED || service !== "cleaning") {
      return null;
    }
    const hasRooms = CLEANING_V1_ROOM_KEYS.some((key) => roomCounts[key] > 0);
    if (cleaningType == null || !hasRooms) {
      return { status: "incomplete" };
    }
    try {
      const result = calculateCleaningV1Price({
        rooms: roomCounts,
        cleaningType,
        addons: addonCounts,
      });
      if ("error" in result) {
        return { status: "invalid" };
      }
      if (result.adminReviewRequired || result.customerPriceEuro == null) {
        return { status: "quote", result };
      }
      return { status: "fixed", result };
    } catch {
      return { status: "invalid" };
    }
  }, [service, roomCounts, addonCounts, cleaningType]);

  const cleaningV1PresetFromPrices = useMemo(() => {
    if (cleaningType == null) {
      return null;
    }
    const out = {} as Record<CleaningV1PresetId, number | null>;
    for (const presetId of CLEANING_V1_PRESET_IDS) {
      const priced = calculateCleaningV1Price({
        rooms: CLEANING_V1_PRESETS[presetId],
        cleaningType,
      });
      out[presetId] =
        "error" in priced || priced.customerPriceEuro == null
          ? null
          : priced.customerPriceEuro;
    }
    return out;
  }, [cleaningType]);

  const cleaningV1BaseRooms = activePreset
    ? CLEANING_V1_PRESETS[activePreset]
    : EMPTY_CLEANING_V1_ROOMS;

  const isCleaningV1Booking =
    CLEANING_V1_BOOKING_ENABLED && service === "cleaning";
  const isCleaningV1PreviewOnly =
    isCleaningV1Booking && !CLEANING_V1_ORDERS_CLIENT_ENABLED;
  const cleaningV1ConfigReady =
    cleaningV1Estimate?.status === "fixed" ||
    cleaningV1Estimate?.status === "quote";
  const massageV1ConfigReady = !isMassageV1Booking || massageTariffId != null;

  function selectMassageTariff(next: MassageV1TariffId) {
    setMassageTariffId(next);
    if (next === "premium-wellness-120") {
      setWellnessEquipmentIds([]);
    }
  }

  function toggleWellnessEquipment(id: WellnessEquipmentId) {
    if (isPremiumTariff) return;
    setWellnessEquipmentIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

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
    setRoomCounts(EMPTY_CLEANING_V1_ROOMS);
    setExtraRoomCounts(EMPTY_CLEANING_V1_ROOMS);
    setExtraRoomsCapNoticeKeys([]);
    setAddonCounts(EMPTY_CLEANING_V1_ADDONS);
    setCleaningType(null);
    setActivePreset(null);
    setMassageMinutes(60);
    setMassageTariffId(MASSAGE_V1_UI_ENABLED ? initialMassageTariffId : null);
    setWellnessEquipmentIds([]);
    setEquipmentModalId(null);
    setProblemDescription("");
    setDraftId(null);
    setDraftToken(null);
    if (!options?.preserveAttempt) {
      clearBookingAttempt();
      setHasUnresolvedAttempt(false);
      setEstimateNeedsConfirm(false);
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
    setEstimateNeedsConfirm(false);
    resetWizardFields();
  }

  /** Keep the same idempotency key; customer acknowledges the live v1 estimate. */
  function confirmRevisedCleaningV1Estimate() {
    const pending = readBookingAttempt();
    if (!pending) {
      setEstimateNeedsConfirm(false);
      clearError();
      return;
    }
    writeBookingAttempt({
      ...pending,
      quoteRevision: CLEANING_V1_QUOTE_REVISION,
    });
    setEstimateNeedsConfirm(false);
    setHasUnresolvedAttempt(true);
    clearError();
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

  // Measure active step pane so stage min-height eases between steps (never clip to 0).
  useLayoutEffect(() => {
    if (!open || successRef) return;
    const pane = stepPaneRef.current;
    if (!pane) return;

    const applyHeight = () => {
      const next = pane.offsetHeight;
      if (next <= 0) return;
      const prev = stageHeightValueRef.current;
      stageHeightValueRef.current = next;
      setStageHeightShrinking(prev != null && next < prev);
      setStageHeight(next);
    };
    applyHeight();

    const observer = new ResizeObserver(applyHeight);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [open, successRef, step, service, rooms, massageMinutes]);

  // Keep focused fields visible above the sticky footer / soft keyboard.
  useEffect(() => {
    if (!open) return;
    const scroller = bookingScrollRef.current;
    if (!scroller) return;

    const applyKeyboardInset = () => {
      const viewport = window.visualViewport;
      if (!viewport) {
        scroller.style.paddingBottom = "";
        return 0;
      }
      // Soft keyboard typically shrinks visualViewport within the layout viewport.
      const inset = Math.max(
        0,
        Math.round(window.innerHeight - viewport.height - viewport.offsetTop),
      );
      scroller.style.paddingBottom = inset > 0 ? `${inset}px` : "";
      return inset;
    };

    const revealFocusedField = (behavior: ScrollBehavior) => {
      const active = document.activeElement;
      if (!isBookingTextField(active) || !scroller.contains(active)) return;
      active.scrollIntoView({ block: "center", behavior });
    };

    const onFocusIn = (event: FocusEvent) => {
      if (!isBookingTextField(event.target)) return;
      window.requestAnimationFrame(() => {
        applyKeyboardInset();
        revealFocusedField(reducedMotion ? "auto" : "smooth");
      });
    };

    const onViewportChange = () => {
      applyKeyboardInset();
      revealFocusedField("auto");
    };

    applyKeyboardInset();
    scroller.addEventListener("focusin", onFocusIn);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", onViewportChange);
    viewport?.addEventListener("scroll", onViewportChange);
    return () => {
      scroller.style.paddingBottom = "";
      scroller.removeEventListener("focusin", onFocusIn);
      viewport?.removeEventListener("resize", onViewportChange);
      viewport?.removeEventListener("scroll", onViewportChange);
    };
  }, [open, reducedMotion]);

  function settleStepTransition(expectedGen: number) {
    if (expectedGen !== stepTransitionGenRef.current) return;
    const wasLocked = stepTransitionLockRef.current;
    const pending = pendingStepNavRef.current;
    if (!wasLocked && pending == null) return;

    stepTransitionLockRef.current = false;
    pendingStepNavRef.current = null;

    if (pending != null) {
      // Apply the latest Back/Next/jump after the in-flight pane settles.
      queueMicrotask(() => {
        if (pending === "back") goBack();
        else if (pending === "next") goNext();
        else navigateToStep(pending.index);
      });
      return;
    }

    if (!skipStepFocusRef.current) {
      stepHeadingRef.current?.focus({ preventScroll: true });
    }
  }

  // Focus the step label after in-wizard navigation (not on initial modal open).
  useEffect(() => {
    if (!open) {
      skipStepFocusRef.current = true;
      stepTransitionLockRef.current = false;
      pendingStepNavRef.current = null;
      stepTransitionGenRef.current += 1;
      stageHeightValueRef.current = null;
      setStageHeight(null);
      setStageHeightShrinking(false);
      return;
    }
    if (skipStepFocusRef.current) {
      skipStepFocusRef.current = false;
      stepTransitionLockRef.current = false;
      pendingStepNavRef.current = null;
      return;
    }
    const expectedGen = stepTransitionGenRef.current;
    // Fallback if Motion skips onAnimationComplete (mode=wait = exit+enter).
    const delayMs = reducedMotion ? 40 : Math.round(STEP_MS * 1000 * 2 + 80);
    const timer = window.setTimeout(() => {
      settleStepTransition(expectedGen);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [step, open, reducedMotion]);

  function onStepPaneAnimationComplete(definition: unknown) {
    // Ignore exit completion (mode=wait); only settle after enter/"center".
    if (definition === "exit") return;
    settleStepTransition(stepTransitionGenRef.current);
  }

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
      if (service === "cleaning") {
        if (CLEANING_V1_BOOKING_ENABLED) {
          if (!cleaningV1ConfigReady) {
            return "cleaningV1Incomplete";
          }
          return null;
        }
        if (rooms == null) {
          return "chooseRooms";
        }
      }
      if (service === "repair" && problemDescription.trim().length < 10) {
        return "repairDetail";
      }
      if (isMassageV1Booking && massageTariffId == null) {
        return "massageV1Incomplete";
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

  function navigateToStep(nextIndex: number) {
    const clamped = Math.max(0, Math.min(STEPS.length - 1, nextIndex));
    if (clamped === stepIndex) return;
    if (stepTransitionLockRef.current) {
      // Keep the latest absolute target; applied once the current pane settles.
      pendingStepNavRef.current = { index: clamped };
      return;
    }
    stepTransitionGenRef.current += 1;
    stepTransitionLockRef.current = true;
    pendingStepNavRef.current = null;
    setStepDirection(clamped > stepIndex ? 1 : -1);
    setStepIndex(clamped);
  }

  function goNext() {
    if (stepTransitionLockRef.current) {
      pendingStepNavRef.current = "next";
      return;
    }
    const code = validateStep(step);
    if (code) {
      setErrorCode(code);
      return;
    }
    clearError();
    navigateToStep(stepIndex + 1);
  }

  function goBack() {
    if (stepTransitionLockRef.current) {
      pendingStepNavRef.current = "back";
      return;
    }
    clearError();
    navigateToStep(stepIndex - 1);
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
        navigateToStep(STEPS.indexOf(id));
        return;
      }
    }

    if (service === "repair" && hasFailedPhotos) {
      setErrorCode("fixFailedPhotos");
      navigateToStep(STEPS.indexOf("configure"));
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

    if (isCleaningV1Booking) {
      if (!cleaningV1ConfigReady || cleaningType == null) {
        setErrorCode("cleaningV1Incomplete");
        navigateToStep(STEPS.indexOf("configure"));
        return;
      }
      if (isCleaningV1PreviewOnly) {
        setErrorCode("cleaningV1PreviewOnly");
        navigateToStep(STEPS.indexOf("configure"));
        return;
      }
    } else if (service === "cleaning" && rooms == null) {
      setErrorCode("chooseRooms");
      navigateToStep(STEPS.indexOf("configure"));
      return;
    }

    if (isMassageV1Booking) {
      if (massageTariffId == null) {
        setErrorCode("massageV1Incomplete");
        navigateToStep(STEPS.indexOf("configure"));
        return;
      }
      if (isMassageV1PreviewOnly) {
        setErrorCode("massageV1PreviewOnly");
        navigateToStep(STEPS.indexOf("configure"));
        return;
      }
    }

    submittingRef.current = true;
    setSending(true);
    clearError();

    try {
      const massageCategoryValue =
        service === "massage" && !isMassageV1Booking
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
        massageCategory: isMassageV1Booking ? null : massageCategoryValue,
        rooms: isCleaningV1Booking
          ? null
          : service === "cleaning"
            ? rooms
            : null,
        massageMinutes:
          service === "massage" && !isMassageV1Booking ? massageMinutes : null,
        repairPhotoPaths: service === "repair" ? repairPhotoPaths : null,
        ...(isCleaningV1Booking && cleaningType != null
          ? {
              cleaningPricingVersion: "v1" as const,
              roomCounts,
              cleaningType,
              ...(cleaningV1AddonsHaveWork(addonCounts)
                ? { addons: addonCounts }
                : {}),
            }
          : {}),
        ...(isMassageV1Booking && massageTariffId != null
          ? {
              massageVersion: "v1" as const,
              massageTariffId,
              ...(wellnessEquipmentIds.length > 0 && !isPremiumTariff
                ? { wellnessEquipmentIds }
                : {}),
            }
          : {}),
      });

      // Stale field fingerprints must not reuse the key. Quote-engine revisions
      // keep the key but require an explicit estimate confirmation first.
      const persisted = readBookingAttempt();
      if (persisted && persisted.fingerprint !== fingerprint) {
        setErrorCode("attemptPayloadChanged");
        setHasUnresolvedAttempt(true);
        return;
      }
      if (
        isCleaningV1Booking &&
        persisted &&
        persisted.fingerprint === fingerprint &&
        isBookingAttemptQuoteStale(persisted, CLEANING_V1_QUOTE_REVISION)
      ) {
        setEstimateNeedsConfirm(true);
        setHasUnresolvedAttempt(true);
        setErrorCode("estimateRevised");
        navigateToStep(STEPS.indexOf("configure"));
        return;
      }
      if (
        isMassageV1Booking &&
        persisted &&
        persisted.fingerprint === fingerprint &&
        isBookingAttemptQuoteStale(persisted, MASSAGE_V1_QUOTE_REVISION)
      ) {
        setEstimateNeedsConfirm(true);
        setHasUnresolvedAttempt(true);
        setErrorCode("estimateRevised");
        navigateToStep(STEPS.indexOf("configure"));
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
        ...(isCleaningV1Booking
          ? { quoteRevision: CLEANING_V1_QUOTE_REVISION }
          : {}),
        ...(isMassageV1Booking
          ? { quoteRevision: MASSAGE_V1_QUOTE_REVISION }
          : {}),
      });
      setHasUnresolvedAttempt(true);
      setEstimateNeedsConfirm(false);

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
          ...(isCleaningV1Booking && cleaningType != null
            ? {
                cleaningPricingVersion: "v1",
                roomCounts,
                cleaningType,
                ...(cleaningV1AddonsHaveWork(addonCounts)
                  ? { addons: addonCounts }
                  : {}),
              }
            : {
                rooms: service === "cleaning" ? rooms : undefined,
              }),
          ...(isMassageV1Booking && massageTariffId != null
            ? {
                massageVersion: "v1",
                massageTariffId,
                massageQuoteRevision: MASSAGE_V1_QUOTE_REVISION,
                ...(wellnessEquipmentIds.length > 0 && !isPremiumTariff
                  ? { wellnessEquipmentIds }
                  : {}),
              }
            : {
                massageMinutes:
                  service === "massage" ? massageMinutes : undefined,
                massageCategory: massageCategoryValue || undefined,
              }),
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

  const stepOffset = reducedMotion ? 0 : STEP_OFFSET_X;
  const stepTransition = {
    duration: reducedMotion ? 0.01 : STEP_MS,
    ease: BOOKING_EASE,
  };
  // Grow instantly so new fields are never clipped; shrink slightly faster than crossfade.
  const stageHeightTransition = {
    duration: reducedMotion
      ? 0.01
      : stageHeightShrinking
        ? STAGE_SHRINK_MS
        : 0.01,
    ease: BOOKING_EASE,
  };
  const stepVariants = {
    enter: (direction: number) => ({
      opacity: 0,
      x: stepOffset * direction,
    }),
    center: {
      opacity: 1,
      x: 0,
    },
    exit: (direction: number) => ({
      opacity: 0,
      x: stepOffset * -direction,
      pointerEvents: "none" as const,
    }),
  };

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
              {isMassageV1Booking && massageTariffId ? (
                <p className="mt-1 text-sm font-medium text-olive">
                  {t(`massageV1Tariffs.${massageTariffId}`)}
                </p>
              ) : massageCategory ? (
                <p className="mt-1 text-sm font-medium text-olive">
                  {tMassage(`categories.${massageCategory.id}.title`)}
                </p>
              ) : null}
              <p className="mt-1 text-sm text-muted">
                {isMassageV1Booking
                  ? t("massageV1HomeVisitIncluded")
                  : rateLabel}
              </p>
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
              <div
                className="flex gap-1"
                aria-hidden="true"
              >
                {STEPS.map((id, index) => (
                  <div
                    key={id}
                    className="booking-step-progress-track relative h-1 flex-1 overflow-hidden bg-mist"
                  >
                    <motion.div
                      className="absolute inset-y-0 left-0 bg-olive"
                      initial={false}
                      animate={{ width: index <= stepIndex ? "100%" : "0%" }}
                      transition={{
                        duration: reducedMotion ? 0.01 : STEP_MS,
                        ease: BOOKING_EASE,
                      }}
                    />
                  </div>
                ))}
              </div>
              <p
                ref={stepHeadingRef}
                id={stepHeadingId}
                tabIndex={-1}
                className="mt-2 text-xs tracking-[0.14em] text-muted uppercase outline-none"
                aria-live="polite"
              >
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
              {estimateNeedsConfirm &&
              isCleaningV1Booking &&
              cleaningV1Estimate?.status === "fixed" &&
              cleaningV1Estimate.result.customerPriceEuro != null ? (
                <div className="mt-3 space-y-2 border-t border-gold/30 pt-3">
                  <p className="text-sm text-ink">
                    {t("estimateRevisedBody", {
                      total: formatEuro(
                        cleaningV1Estimate.result.customerPriceEuro,
                      ),
                    })}
                  </p>
                  <button
                    type="button"
                    onClick={confirmRevisedCleaningV1Estimate}
                    className="text-sm font-semibold text-olive underline-offset-2 hover:underline"
                  >
                    {t("confirmRevisedEstimate")}
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                onClick={startNewBookingAttempt}
                className="mt-2 block text-sm font-semibold text-olive underline-offset-2 hover:underline"
              >
                {t("startNewBooking")}
              </button>
            </div>
          ) : null}
        </div>

        <div
          ref={bookingScrollRef}
          className="booking-overlay-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]"
        >
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
            {service === "repair" ||
            (isCleaningV1Booking && cleaningV1Estimate?.status === "quote") ? (
              <p className="text-sm text-muted">
                {service === "repair"
                  ? t("successRepairNote")
                  : t("successCleaningV1QuoteNote")}
              </p>
            ) : (
              <p className="text-sm text-muted">
                {t("successEstimatedTotal", {
                  total: formatEuro(
                    isCleaningV1Booking &&
                      cleaningV1Estimate?.status === "fixed" &&
                      cleaningV1Estimate.result.customerPriceEuro != null
                      ? cleaningV1Estimate.result.customerPriceEuro
                      : (total ?? 0),
                  ),
                })}
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
            <motion.div
              className="booking-step-stage relative overflow-x-hidden"
              initial={false}
              animate={
                stageHeight == null ? undefined : { minHeight: stageHeight }
              }
              transition={stageHeightTransition}
            >
              <AnimatePresence
                initial={false}
                custom={stepDirection}
                mode="wait"
              >
                <motion.div
                  key={step}
                  ref={stepPaneRef}
                  role="group"
                  aria-labelledby={stepHeadingId}
                  custom={stepDirection}
                  variants={stepVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={stepTransition}
                  onAnimationComplete={onStepPaneAnimationComplete}
                  className="booking-step-pane space-y-6"
                >
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
              <div className="rounded-xl border border-mist bg-white px-4 py-3 text-center sm:px-5 sm:py-4">
                <p className="text-xs font-medium tracking-[0.18em] text-muted uppercase">
                  {t("total")}
                </p>
                <p className="mt-1 font-display text-3xl font-bold tracking-tight text-olive sm:text-4xl">
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
              <div className="booking-cleaning-rooms space-y-4">
                {CLEANING_V1_BOOKING_ENABLED ? (
                  <>
                    {isCleaningV1PreviewOnly ? (
                      <div
                        className="rounded-xl border border-gold/40 bg-gold/10 px-3 py-3 text-sm text-ink"
                        role="status"
                      >
                        {t("cleaningV1PreviewHint")}
                      </div>
                    ) : null}

                    <div>
                      <p className="mb-2 block text-sm font-medium text-ink">
                        {t("cleaningV1TypeLabel")}
                      </p>
                      <div
                        className="grid grid-cols-1 gap-2 sm:grid-cols-3"
                        role="group"
                        aria-label={t("cleaningV1TypeLabel")}
                      >
                        {CLEANING_V1_TYPES.map((type) => {
                          const selected = cleaningType === type;
                          return (
                            <button
                              key={type}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => {
                                setCleaningType(type);
                                clearError();
                              }}
                              className={`booking-room-option havenly-control px-3 py-3 text-sm font-semibold transition ${
                                selected
                                  ? "border border-olive bg-olive text-white shadow-sm shadow-olive/20"
                                  : "border border-mist bg-white text-ink hover:border-olive"
                              }`}
                            >
                              {t(`cleaningV1Types.${type}`)}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 block text-sm font-medium text-ink">
                        {t("cleaningV1PresetsHeading")}
                      </p>
                      <div
                        className="grid grid-cols-3 gap-2"
                        role="group"
                        aria-label={t("cleaningV1PresetsHeading")}
                      >
                        {CLEANING_V1_PRESET_IDS.map((presetId) => {
                          const selected = activePreset === presetId;
                          const fromPrice =
                            cleaningV1PresetFromPrices?.[presetId] ?? null;
                          return (
                            <button
                              key={presetId}
                              type="button"
                              aria-pressed={selected}
                              disabled={cleaningType == null}
                              onClick={() => {
                                const base = CLEANING_V1_PRESETS[presetId];
                                const applied = clampCleaningV1ExtraRoomsForPreset(
                                  base,
                                  extraRoomCounts,
                                );
                                setActivePreset(presetId);
                                setExtraRoomCounts(applied.extras);
                                setRoomCounts(applied.totals);
                                setExtraRoomsCapNoticeKeys(applied.reducedKeys);
                                clearError();
                              }}
                              className={`booking-room-option havenly-control flex flex-col items-center gap-1 px-2 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${
                                selected
                                  ? "border border-olive bg-olive text-white shadow-sm shadow-olive/20"
                                  : "border border-mist bg-white text-ink hover:border-olive"
                              }`}
                            >
                              <span>{t(`cleaningV1Presets.${presetId}`)}</span>
                              <span
                                className={`text-[0.7rem] font-medium tracking-wide ${
                                  selected ? "text-white/85" : "text-muted"
                                }`}
                              >
                                {fromPrice != null
                                  ? t("cleaningV1PresetFrom", {
                                      price: formatEuro(fromPrice),
                                    })
                                  : t("cleaningV1PresetFromPending")}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-xs text-muted">
                        {t("cleaningV1PresetsHint")}
                      </p>
                      {extraRoomsCapNoticeKeys.length > 0 ? (
                        <p
                          className="mt-2 text-xs leading-snug text-olive"
                          role="status"
                        >
                          {t("cleaningV1ExtraRoomsCapped", {
                            rooms: extraRoomsCapNoticeKeys
                              .map((key) => t(`cleaningV1RoomLabels.${key}`))
                              .join(", "),
                          })}
                        </p>
                      ) : null}
                    </div>

                    {activePreset != null ? (
                      <div>
                        <p className="mb-2 block text-sm font-medium text-ink">
                          {t("cleaningV1IncludedHeading")}
                        </p>
                        <ul className="space-y-1.5 text-sm text-ink/85">
                          {CLEANING_V1_ROOM_KEYS.filter(
                            (key) => cleaningV1BaseRooms[key] > 0,
                          ).map((key) => (
                            <li
                              key={key}
                              className="flex items-baseline justify-between gap-3 border-b border-mist/70 pb-1.5 last:border-b-0 last:pb-0"
                            >
                              <span>{t(`cleaningV1RoomLabels.${key}`)}</span>
                              <span className="shrink-0 text-olive">
                                {cleaningV1BaseRooms[key]}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {activePreset != null && cleaningType != null ? (
                      <div>
                        <p className="mb-1 block text-sm font-medium text-ink">
                          {t("cleaningV1ExtraRoomsHeading")}
                        </p>
                        <p className="mb-3 text-xs text-muted">
                          {t("cleaningV1ExtraRoomsHint")}
                        </p>
                        <div className="space-y-3">
                          {CLEANING_V1_ROOM_KEYS.map((key) => {
                            const label = t(`cleaningV1RoomLabels.${key}`);
                            const extra = extraRoomCounts[key];
                            const maxExtra = Math.max(
                              0,
                              CLEANING_V1_MAX_ROOMS_PER_TYPE -
                                cleaningV1BaseRooms[key],
                            );
                            const unitMinutes =
                              cleaningV1RoomUnitMinutes(key) *
                              cleaningV1CleaningTypeMultiplier(cleaningType);
                            const nextRooms = {
                              ...roomCounts,
                              [key]: Math.min(
                                CLEANING_V1_MAX_ROOMS_PER_TYPE,
                                roomCounts[key] + 1,
                              ),
                            };
                            const deltaEuro =
                              maxExtra > 0
                                ? cleaningV1CustomerPriceDeltaEuro(
                                    {
                                      rooms: roomCounts,
                                      cleaningType,
                                      addons: addonCounts,
                                    },
                                    {
                                      rooms: nextRooms,
                                      cleaningType,
                                      addons: addonCounts,
                                    },
                                  )
                                : null;
                            return (
                              <div
                                key={key}
                                className="booking-cleaning-qty"
                                role="group"
                                aria-label={label}
                              >
                                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                                  <span className="text-xs font-medium text-ink/80">
                                    {label}
                                  </span>
                                  <span className="text-[0.7rem] text-muted">
                                    {t("cleaningV1AddUnitMeta", {
                                      time:
                                        Math.round(unitMinutes) % 60 === 0
                                          ? t("cleaningV1UnitHours", {
                                              count:
                                                Math.round(unitMinutes) / 60,
                                            })
                                          : t("cleaningV1UnitMinutes", {
                                              count: Math.round(unitMinutes),
                                            }),
                                      price:
                                        deltaEuro == null
                                          ? "—"
                                          : deltaEuro === 0
                                            ? t("cleaningV1AddUnitPriceAbsorbed")
                                            : `+${formatEuro(deltaEuro)}`,
                                    })}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <button
                                    type="button"
                                    aria-label={t("decrease", { label })}
                                    disabled={extra <= 0}
                                    onClick={() => {
                                      const nextExtra = {
                                        ...extraRoomCounts,
                                        [key]: Math.max(0, extra - 1),
                                      };
                                      setExtraRoomCounts(nextExtra);
                                      setRoomCounts(
                                        mergeCleaningV1BaseAndExtra(
                                          cleaningV1BaseRooms,
                                          nextExtra,
                                        ),
                                      );
                                      setExtraRoomsCapNoticeKeys([]);
                                      clearError();
                                    }}
                                    className="havenly-control inline-flex h-11 w-11 items-center justify-center border border-mist bg-white text-lg text-ink transition hover:border-olive disabled:opacity-40"
                                  >
                                    −
                                  </button>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    readOnly
                                    value={String(extra)}
                                    aria-valuemin={0}
                                    aria-valuemax={maxExtra}
                                    aria-valuenow={extra}
                                    className="havenly-control w-full border border-mist bg-white px-4 py-3 text-center text-ink outline-none"
                                  />
                                  <button
                                    type="button"
                                    aria-label={t("increase", { label })}
                                    disabled={extra >= maxExtra}
                                    onClick={() => {
                                      const nextExtra = {
                                        ...extraRoomCounts,
                                        [key]: Math.min(maxExtra, extra + 1),
                                      };
                                      setExtraRoomCounts(nextExtra);
                                      setRoomCounts(
                                        mergeCleaningV1BaseAndExtra(
                                          cleaningV1BaseRooms,
                                          nextExtra,
                                        ),
                                      );
                                      setExtraRoomsCapNoticeKeys([]);
                                      clearError();
                                    }}
                                    className="havenly-control inline-flex h-11 w-11 items-center justify-center border border-mist bg-white text-lg text-ink transition hover:border-olive disabled:opacity-40"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {activePreset != null && cleaningType != null ? (
                      <div>
                        <p className="mb-1 block text-sm font-medium text-ink">
                          {t("cleaningV1AddonsHeading")}
                        </p>
                        <p className="mb-3 text-xs text-muted">
                          {t("cleaningV1AddonsSectionHint")}
                        </p>
                        <div className="space-y-3">
                          {CLEANING_V1_ADDON_KEYS.map((key: CleaningV1AddonId) => {
                            const label = t(`cleaningV1AddonLabels.${key}`);
                            const count = addonCounts[key];
                            const maxCount = cleaningV1MaxAddonCount(key);
                            const unitHint =
                              key === "windows"
                                ? t("cleaningV1AddonHints.windows")
                                : null;
                            const unitMinutes = CLEANING_V1_ADDON_MINUTES[key];
                            const nextAddons = {
                              ...addonCounts,
                              [key]: Math.min(maxCount, count + 1),
                            };
                            const deltaEuro =
                              count < maxCount
                                ? cleaningV1CustomerPriceDeltaEuro(
                                    {
                                      rooms: roomCounts,
                                      cleaningType,
                                      addons: addonCounts,
                                    },
                                    {
                                      rooms: roomCounts,
                                      cleaningType,
                                      addons: nextAddons,
                                    },
                                  )
                                : null;
                            return (
                              <div
                                key={key}
                                className="booking-cleaning-qty"
                                role="group"
                                aria-label={label}
                              >
                                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                                  <span className="text-xs font-medium text-ink/80">
                                    {label}
                                  </span>
                                  <span className="text-[0.7rem] text-muted">
                                    {t("cleaningV1AddUnitMeta", {
                                      time: t("cleaningV1UnitMinutes", {
                                        count: unitMinutes,
                                      }),
                                      price:
                                        deltaEuro == null
                                          ? "—"
                                          : deltaEuro === 0
                                            ? t("cleaningV1AddUnitPriceAbsorbed")
                                            : `+${formatEuro(deltaEuro)}`,
                                    })}
                                  </span>
                                </div>
                                {unitHint ? (
                                  <p className="mb-2 text-xs leading-snug text-muted">
                                    {unitHint}
                                  </p>
                                ) : null}
                                <div className="flex items-center gap-3">
                                  <button
                                    type="button"
                                    aria-label={t("decrease", { label })}
                                    disabled={count <= 0}
                                    onClick={() => {
                                      setAddonCounts((prev) => ({
                                        ...prev,
                                        [key]: Math.max(0, prev[key] - 1),
                                      }));
                                      clearError();
                                    }}
                                    className="havenly-control inline-flex h-11 w-11 items-center justify-center border border-mist bg-white text-lg text-ink transition hover:border-olive disabled:opacity-40"
                                  >
                                    −
                                  </button>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    readOnly
                                    value={String(count)}
                                    aria-valuemin={0}
                                    aria-valuemax={maxCount}
                                    aria-valuenow={count}
                                    className="havenly-control w-full border border-mist bg-white px-4 py-3 text-center text-ink outline-none"
                                  />
                                  <button
                                    type="button"
                                    aria-label={t("increase", { label })}
                                    disabled={count >= maxCount}
                                    onClick={() => {
                                      setAddonCounts((prev) => ({
                                        ...prev,
                                        [key]: Math.min(
                                          maxCount,
                                          prev[key] + 1,
                                        ),
                                      }));
                                      clearError();
                                    }}
                                    className="havenly-control inline-flex h-11 w-11 items-center justify-center border border-mist bg-white text-lg text-ink transition hover:border-olive disabled:opacity-40"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    <div>
                      <p className="mb-2 block text-sm font-medium text-ink">
                        {t("cleaningV1EstimateHeading")}
                      </p>
                    <div
                      className="booking-cleaning-estimate rounded-xl border border-sand bg-sand/70 px-3 py-2.5 text-ink sm:px-4 sm:py-3"
                      aria-live="polite"
                    >
                      <AnimatePresence initial={false} mode="wait">
                        {cleaningV1Estimate?.status === "fixed" &&
                        cleaningV1Estimate.result.customerPriceEuro != null ? (
                          <motion.div
                            key="v1-estimate-fixed"
                            initial={reducedMotion ? false : { opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={reducedMotion ? undefined : { opacity: 0 }}
                            transition={{
                              duration: reducedMotion ? 0 : 0.2,
                              ease: BOOKING_EASE,
                            }}
                          >
                            <div className="booking-cleaning-metrics booking-cleaning-metrics--v1">
                              <div className="booking-cleaning-metric">
                                <p className="booking-cleaning-metric-label">
                                  {t("cleaningV1TeamLabel")}
                                </p>
                                <p className="booking-cleaning-metric-value">
                                  {t("cleanerCount", {
                                    count:
                                      cleaningV1Estimate.result
                                        .recommendedCleaners,
                                  })}
                                </p>
                              </div>
                              <div className="booking-cleaning-metric">
                                <p className="booking-cleaning-metric-label">
                                  {t("cleaningV1VisitLabel")}
                                </p>
                                <p className="booking-cleaning-metric-value">
                                  ~
                                  {t("cleaningV1VisitDuration", {
                                    hours: Math.floor(
                                      cleaningV1Estimate.result
                                        .estimatedVisitMinutes / 60,
                                    ),
                                    minutes:
                                      cleaningV1Estimate.result
                                        .estimatedVisitMinutes % 60,
                                  })}
                                </p>
                              </div>
                              <div className="booking-cleaning-metric">
                                <p className="booking-cleaning-metric-label">
                                  {t("cleaningV1PersonHoursLabel")}
                                </p>
                                <p className="booking-cleaning-metric-value">
                                  {cleaningV1Estimate.result.billableHours}
                                </p>
                              </div>
                              <div className="booking-cleaning-metric">
                                <p className="booking-cleaning-metric-label">
                                  {t("cleaningV1RateLabel")}
                                </p>
                                <p className="booking-cleaning-metric-value">
                                  {t("cleaningV1RateValue", {
                                    rate: formatEuro(
                                      CLEANING_V1_HOURLY_RATE_EURO,
                                    ),
                                  })}
                                </p>
                              </div>
                              <div className="booking-cleaning-metric booking-cleaning-metric--total">
                                <p className="booking-cleaning-metric-label">
                                  {t("total")}
                                </p>
                                <p className="booking-cleaning-metric-value booking-cleaning-metric-total">
                                  {formatEuro(
                                    cleaningV1Estimate.result.customerPriceEuro,
                                  )}
                                </p>
                              </div>
                            </div>
                            {cleaningV1Estimate.result.minimumPriceApplied ? (
                              <p className="booking-cleaning-formula mt-2 text-xs leading-snug text-olive/80 sm:text-sm">
                                {t("cleaningV1MinimumPriceNote", {
                                  min: formatEuro(CLEANING_V1_MIN_PRICE_EURO),
                                })}
                              </p>
                            ) : null}
                            <p className="booking-cleaning-formula mt-2 text-xs leading-snug text-olive/80 sm:text-sm">
                              {t("cleaningV1EstimateNote")}
                            </p>
                            <p className="mt-1 text-xs leading-snug text-muted sm:text-sm">
                              {t("cleaningV1ExtrasConfirmNote")}
                            </p>
                          </motion.div>
                        ) : cleaningV1Estimate?.status === "quote" ? (
                          <motion.div
                            key="v1-estimate-quote"
                            initial={reducedMotion ? false : { opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={reducedMotion ? undefined : { opacity: 0 }}
                            transition={{
                              duration: reducedMotion ? 0 : 0.2,
                              ease: BOOKING_EASE,
                            }}
                            className="booking-cleaning-estimate-idle"
                          >
                            <p className="text-sm font-medium text-ink">
                              {t("cleaningV1QuoteTitle")}
                            </p>
                            <p className="mt-1 text-xs leading-snug text-muted sm:text-sm">
                              {t("cleaningV1QuoteBody")}
                            </p>
                          </motion.div>
                        ) : (
                          <motion.div
                            key="v1-estimate-idle"
                            initial={reducedMotion ? false : { opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={reducedMotion ? undefined : { opacity: 0 }}
                            transition={{
                              duration: reducedMotion ? 0 : 0.2,
                              ease: BOOKING_EASE,
                            }}
                            className="booking-cleaning-estimate-idle"
                          >
                            <p className="text-xs leading-snug text-muted sm:text-sm">
                              {cleaningV1Estimate?.status === "invalid"
                                ? t("cleaningV1InvalidHint")
                                : t("cleaningV1IncompleteHint")}
                            </p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <p className="mb-2 block text-sm font-medium text-ink">
                        {roomsLabel}
                      </p>
                      <div
                        className="grid grid-cols-3 gap-2 sm:grid-cols-6"
                        role="group"
                        aria-label={roomsLabel}
                      >
                        {[1, 2, 3, 4, 5, 6].map((count) => {
                          const selected = rooms === count;
                          return (
                            <button
                              key={count}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => {
                                setRooms(selected ? null : count);
                                clearError();
                              }}
                              className={`booking-room-option havenly-control px-3 py-3 text-sm font-semibold transition ${
                                selected
                                  ? "border border-olive bg-olive text-white shadow-sm shadow-olive/20"
                                  : "border border-mist bg-white text-ink hover:border-olive"
                              }`}
                            >
                              {count}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div
                      className="booking-cleaning-qty"
                      role="group"
                      aria-label={roomsLabel}
                    >
                      <label htmlFor="cleaning-rooms" className="sr-only">
                        {roomsLabel}
                      </label>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          aria-label={t("decrease", { label: roomsLabel })}
                          disabled={rooms == null}
                          onClick={() => {
                            if (rooms == null) return;
                            setRooms(rooms <= 1 ? null : rooms - 1);
                            clearError();
                          }}
                          className="havenly-control inline-flex h-11 w-11 items-center justify-center border border-mist bg-white text-lg text-ink transition hover:border-olive disabled:opacity-40"
                        >
                          −
                        </button>
                        <input
                          id="cleaning-rooms"
                          type="text"
                          inputMode="numeric"
                          readOnly
                          value={rooms == null ? "—" : String(rooms)}
                          aria-valuemin={1}
                          aria-valuemax={6}
                          aria-valuenow={rooms ?? undefined}
                          aria-valuetext={
                            rooms == null
                              ? undefined
                              : t("roomCount", { count: rooms })
                          }
                          className="havenly-control w-full border border-mist bg-white px-4 py-3 text-center text-ink outline-none"
                        />
                        <button
                          type="button"
                          aria-label={t("increase", { label: roomsLabel })}
                          disabled={rooms != null && rooms >= 6}
                          onClick={() => {
                            setRooms(rooms == null ? 1 : Math.min(6, rooms + 1));
                            clearError();
                          }}
                          className="havenly-control inline-flex h-11 w-11 items-center justify-center border border-mist bg-white text-lg text-ink transition hover:border-olive disabled:opacity-40"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div
                      className="booking-cleaning-estimate rounded-xl border border-sand bg-sand/70 px-3 py-2.5 text-ink sm:px-4 sm:py-3"
                      aria-live="polite"
                    >
                      <AnimatePresence initial={false} mode="wait">
                        {rooms != null && cleaning != null && total != null ? (
                          <motion.div
                            key="estimate-active"
                            initial={reducedMotion ? false : { opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={reducedMotion ? undefined : { opacity: 0 }}
                            transition={{
                              duration: reducedMotion ? 0 : 0.2,
                              ease: BOOKING_EASE,
                            }}
                          >
                            <div className="booking-cleaning-metrics">
                              <div className="booking-cleaning-metric">
                                <p className="booking-cleaning-metric-label">
                                  {t("estimateCleanersLabel")}
                                </p>
                                <p className="booking-cleaning-metric-value">
                                  {t("cleanerCount", { count: cleaning.workers })}
                                </p>
                              </div>
                              <div className="booking-cleaning-metric">
                                <p className="booking-cleaning-metric-label">
                                  {t("estimateDurationLabel")}
                                </p>
                                <p className="booking-cleaning-metric-value">
                                  ~{t("hourCount", { count: cleaning.hours })}
                                </p>
                              </div>
                              <div className="booking-cleaning-metric">
                                <p className="booking-cleaning-metric-label">
                                  {t("total")}
                                </p>
                                <p className="booking-cleaning-metric-value booking-cleaning-metric-total">
                                  {formatEuro(total)}
                                </p>
                              </div>
                            </div>
                            <p className="booking-cleaning-formula mt-2 text-xs leading-snug text-olive/80 sm:text-sm">
                              <span className="font-medium text-ink/70">
                                {t("estimateFormulaLabel")}:{" "}
                              </span>
                              {t("cleaningFormula", {
                                hours: cleaning.hours,
                                workers: cleaning.workers,
                                total: formatEuro(total),
                              })}
                            </p>
                          </motion.div>
                        ) : (
                          <motion.div
                            key="estimate-idle"
                            initial={reducedMotion ? false : { opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={reducedMotion ? undefined : { opacity: 0 }}
                            transition={{
                              duration: reducedMotion ? 0 : 0.2,
                              ease: BOOKING_EASE,
                            }}
                            className="booking-cleaning-estimate-idle"
                          >
                            <p className="text-xs leading-snug text-muted sm:text-sm">
                              {t("chooseRoomsHint")}
                            </p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </>
                )}
              </div>
            ) : null}

            {step === "configure" && service === "massage" ? (
              isMassageV1Booking ? (
                <div className="space-y-6">
                  {isMassageV1PreviewOnly ? (
                    <p className="rounded-[12px] border border-gold/40 bg-gold/10 px-3 py-2.5 text-sm text-ink">
                      {t("massageV1PreviewHint")}
                    </p>
                  ) : null}
                  <div>
                    <p className="mb-3 text-sm font-medium tracking-wide text-ink">
                      {t("massageV1ChooseExperience")}
                    </p>
                    <div className="grid gap-2.5">
                      {MASSAGE_V1_PRIMARY_TARIFFS.map((tariffId) => {
                        const isTargetedCard = tariffId === "targeted-60";
                        const isPremiumCard =
                          tariffId === "premium-wellness-120";
                        const activeTargeted =
                          massageTariffId === "targeted-30" ||
                          massageTariffId === "targeted-60";
                        const active = isTargetedCard
                          ? activeTargeted
                          : massageTariffId === tariffId;
                        const displayTariffId: MassageV1TariffId =
                          isTargetedCard && massageTariffId === "targeted-30"
                            ? "targeted-30"
                            : tariffId;
                        const tariff = MASSAGE_V1_TARIFFS[displayTariffId];
                        return (
                          <div key={tariffId} className="space-y-2">
                            <button
                              type="button"
                              onClick={() =>
                                selectMassageTariff(
                                  isTargetedCard && activeTargeted
                                    ? displayTariffId
                                    : tariffId,
                                )
                              }
                              className={`havenly-control w-full border px-4 py-3.5 text-left transition ${
                                active && isPremiumCard
                                  ? "border-olive bg-olive text-paper shadow-[0_10px_24px_rgba(52,72,61,0.22)]"
                                  : active
                                    ? "border-olive bg-olive/10 text-ink"
                                    : "border-mist bg-white text-ink hover:border-olive/60"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-medium">
                                    {t(`massageV1Tariffs.${displayTariffId}`)}
                                  </p>
                                  <p
                                    className={`mt-1 text-xs ${
                                      active && isPremiumCard
                                        ? "text-paper/70"
                                        : "text-muted"
                                    }`}
                                  >
                                    {MASSAGE_V1_TARIFFS[displayTariffId]
                                      .durationMin}{" "}
                                    min
                                    {isPremiumCard
                                      ? ` · ${t("massageV1IncludedEquipment")}`
                                      : null}
                                  </p>
                                </div>
                                <span
                                  className={`font-display text-lg font-medium ${
                                    active && isPremiumCard
                                      ? "text-gold"
                                      : "text-ink"
                                  }`}
                                >
                                  {formatEuro(centsToEuro(tariff.priceCents))}
                                </span>
                              </div>
                            </button>
                            {isTargetedCard && activeTargeted ? (
                              <div className="flex gap-2 pl-0.5">
                                {(["targeted-30", "targeted-60"] as const).map(
                                  (id) => (
                                    <button
                                      key={id}
                                      type="button"
                                      onClick={() => selectMassageTariff(id)}
                                      className={`havenly-control flex-1 border px-3 py-2 text-sm font-medium transition ${
                                        massageTariffId === id
                                          ? "border-olive bg-olive/10 text-ink"
                                          : "border-mist bg-white text-ink hover:border-olive/50"
                                      }`}
                                    >
                                      {MASSAGE_V1_TARIFFS[id].durationMin} min
                                    </button>
                                  ),
                                )}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <p className="mb-3 text-sm font-medium tracking-wide text-ink">
                      {t("massageV1Enhance")}
                    </p>
                    {isPremiumTariff ? (
                      <ul className="space-y-2">
                        {WELLNESS_EQUIPMENT_IDS.map((id) => (
                          <li
                            key={id}
                            className="flex items-center justify-between rounded-[12px] border border-olive/20 bg-olive/[0.06] px-3.5 py-2.5 text-sm"
                          >
                            <span className="font-medium text-ink">
                              {t(`massageV1EquipmentNames.${id}`)}
                            </span>
                            <span className="text-xs font-medium tracking-wide text-olive uppercase">
                              {tEquip("included")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <ul className="space-y-2.5">
                        {WELLNESS_EQUIPMENT_IDS.map((id) => {
                          const item = WELLNESS_EQUIPMENT[id];
                          const checked = wellnessEquipmentIds.includes(id);
                          return (
                            <li
                              key={id}
                              className={`flex gap-3 rounded-[12px] border px-3 py-3 transition ${
                                checked
                                  ? "border-olive/40 bg-olive/[0.06]"
                                  : "border-mist bg-white"
                              }`}
                            >
                              <Image
                                src={item.deviceImage}
                                alt=""
                                width={56}
                                height={56}
                                sizes="56px"
                                className="h-14 w-14 shrink-0 rounded-[10px] border border-mist/60 bg-sand object-contain p-0.5"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-medium text-ink">
                                      {t(`massageV1EquipmentNames.${id}`)}
                                    </p>
                                    <p className="mt-0.5 text-xs leading-relaxed text-muted">
                                      {tEquip(`items.${id}.short`)}
                                    </p>
                                  </div>
                                  <label className="flex items-center gap-2 pt-0.5 text-sm">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={!MASSAGE_V1_EQUIPMENT_UI_BOOKABLE}
                                      onChange={() =>
                                        toggleWellnessEquipment(id)
                                      }
                                      className="h-4 w-4 accent-olive"
                                    />
                                  </label>
                                </div>
                                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                                  <span>
                                    {item.extraBookingMin > 0
                                      ? t("massageV1ExtraTime", {
                                          minutes: item.extraBookingMin,
                                        })
                                      : t("massageV1ProcedureTime", {
                                          minutes: item.procedureMin,
                                        })}
                                  </span>
                                  <span>
                                    {t("massageV1ExtraPrice", {
                                      price: formatEuro(
                                        centsToEuro(item.priceCents),
                                      ),
                                    })}
                                  </span>
                                  <button
                                    type="button"
                                    className="font-semibold text-olive underline-offset-2 hover:underline"
                                    onClick={() => setEquipmentModalId(id)}
                                  >
                                    {t("massageV1LearnMore")}
                                  </button>
                                  {!MASSAGE_V1_EQUIPMENT_UI_BOOKABLE ? (
                                    <span>{t("massageV1ComingSoon")}</span>
                                  ) : null}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>

                  {massageV1Estimate ? (
                    <div className="rounded-[12px] border border-sand bg-sand/70 px-4 py-4 sm:px-5">
                      <p className="text-xs tracking-[0.16em] text-gold uppercase">
                        {t("massageV1EstimateHeading")}
                      </p>
                      <p className="mt-2 font-medium text-ink">
                        {t(`massageV1Tariffs.${massageV1Estimate.tariffId}`)}
                      </p>
                      <p className="mt-1 text-sm text-muted">
                        {t("massageV1BaseDuration", {
                          minutes: massageV1Estimate.baseDurationMin,
                        })}
                      </p>
                      {massageV1Estimate.equipment.length > 0 ? (
                        <p className="mt-1 text-sm text-muted">
                          {t("massageV1SelectedEquipment")}:{" "}
                          {massageV1Estimate.equipment
                            .map((line) =>
                              t(`massageV1EquipmentNames.${line.id}`),
                            )
                            .join(", ")}
                        </p>
                      ) : null}
                      {massageV1Estimate.includedEquipment.length > 0 ? (
                        <p className="mt-1 text-sm text-muted">
                          {t("massageV1IncludedEquipment")}
                        </p>
                      ) : null}
                      <p className="mt-1 text-sm text-muted">
                        {t("massageV1TotalDuration", {
                          minutes: massageV1Estimate.totalSessionMinutes,
                        })}
                      </p>
                      <p className="mt-1 text-sm text-olive">
                        {t("massageV1HomeVisitIncluded")}
                      </p>
                      <p className="mt-3 font-display text-2xl font-medium tracking-tight text-ink">
                        {formatEuro(massageV1Estimate.priceEuro)}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div>
                  <p className="mb-2 text-sm font-medium text-ink">
                    {t("sessionDuration")}
                  </p>
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
              )
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
                  {!isMassageV1Booking && massageCategory ? (
                    <p className="mt-1 text-olive">
                      {tMassage(`categories.${massageCategory.id}.title`)}
                    </p>
                  ) : null}
                  {isCleaningV1Booking &&
                  cleaningV1ConfigReady &&
                  cleaningType != null ? (
                    <div className="mt-2 space-y-1">
                      <p>
                        {t("cleaningV1SummaryType", {
                          type: t(`cleaningV1Types.${cleaningType}`),
                        })}
                      </p>
                      <p>
                        {t("cleaningV1SummaryRooms", {
                          rooms: CLEANING_V1_ROOM_KEYS.filter(
                            (key) => roomCounts[key] > 0,
                          )
                            .map(
                              (key) =>
                                `${roomCounts[key]} ${t(`cleaningV1RoomLabels.${key}`)}`,
                            )
                            .join(", "),
                        })}
                      </p>
                      {cleaningV1AddonsHaveWork(addonCounts) ? (
                        <p>
                          {t("cleaningV1SummaryAddons", {
                            addons: CLEANING_V1_ADDON_KEYS.filter(
                              (key) => addonCounts[key] > 0,
                            )
                              .map(
                                (key) =>
                                  `${addonCounts[key]} ${t(`cleaningV1AddonLabels.${key}`)}`,
                              )
                              .join(", "),
                          })}
                        </p>
                      ) : null}
                      {cleaningV1Estimate?.status === "quote" ? (
                        <p className="text-olive">{t("cleaningV1QuoteTitle")}</p>
                      ) : cleaningV1Estimate?.status === "fixed" &&
                        cleaningV1Estimate.result.customerPriceEuro != null ? (
                        <>
                          <p>
                            {t("cleaningV1SummaryTeam", {
                              team: t("cleanerCount", {
                                count:
                                  cleaningV1Estimate.result.recommendedCleaners,
                              }),
                            })}
                          </p>
                          <p>
                            {t("cleaningV1SummaryVisit", {
                              duration: t("cleaningV1VisitDuration", {
                                hours: Math.floor(
                                  cleaningV1Estimate.result
                                    .estimatedVisitMinutes / 60,
                                ),
                                minutes:
                                  cleaningV1Estimate.result
                                    .estimatedVisitMinutes % 60,
                              }),
                            })}
                          </p>
                          <p>
                            {t("cleaningV1SummaryPersonHours", {
                              hours: cleaningV1Estimate.result.billableHours,
                            })}
                          </p>
                          <p>
                            {t("cleaningV1SummaryRate", {
                              rate: formatEuro(CLEANING_V1_HOURLY_RATE_EURO),
                            })}
                          </p>
                          <p>
                            {t("cleaningV1SummaryPrice", {
                              hours: cleaningV1Estimate.result.billableHours,
                              total: formatEuro(
                                cleaningV1Estimate.result.customerPriceEuro,
                              ),
                            })}
                          </p>
                          {cleaningV1Estimate.result.minimumPriceApplied ? (
                            <p className="text-olive">
                              {t("cleaningV1MinimumPriceNote", {
                                min: formatEuro(CLEANING_V1_MIN_PRICE_EURO),
                              })}
                            </p>
                          ) : null}
                        </>
                      ) : null}
                      <p className="text-xs text-muted">
                        {t("cleaningV1CleanersNote")}
                      </p>
                      <p className="text-xs text-muted">
                        {t("cleaningV1ExtrasConfirmNote")}
                      </p>
                    </div>
                  ) : service === "cleaning" &&
                    rooms != null &&
                    cleaning != null &&
                    total != null ? (
                    <p className="mt-2">
                      {t("cleaningSummary", {
                        rooms: t("roomCount", { count: rooms }),
                        hours: cleaning.hours,
                        cleaners: t("cleanerCount", {
                          count: cleaning.workers,
                        }),
                        total: formatEuro(total),
                      })}
                    </p>
                  ) : null}
                  {isMassageV1Booking && massageV1Estimate ? (
                    <div className="mt-2 space-y-1">
                      <p>
                        {t("massageV1SummaryTariff", {
                          tariff: t(
                            `massageV1Tariffs.${massageV1Estimate.tariffId}`,
                          ),
                        })}
                      </p>
                      {massageV1Estimate.equipment.length > 0 ? (
                        <p>
                          {t("massageV1SelectedEquipment")}:{" "}
                          {massageV1Estimate.equipment
                            .map((line) =>
                              t(`massageV1EquipmentNames.${line.id}`),
                            )
                            .join(", ")}
                        </p>
                      ) : null}
                      {massageV1Estimate.includedEquipment.length > 0 ? (
                        <p>{t("massageV1IncludedEquipment")}</p>
                      ) : null}
                      <p>
                        {t("massageV1SummaryVisit", {
                          minutes: massageV1Estimate.totalSessionMinutes,
                          total: formatEuro(massageV1Estimate.priceEuro),
                        })}
                      </p>
                      <p className="text-olive">
                        {t("massageV1HomeVisitIncluded")}
                      </p>
                    </div>
                  ) : service === "massage" ? (
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
                </motion.div>
              </AnimatePresence>
            </motion.div>

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
                      (service === "cleaning" &&
                        step === "configure" &&
                        (CLEANING_V1_BOOKING_ENABLED
                          ? !cleaningV1ConfigReady
                          : rooms == null)) ||
                      (service === "massage" &&
                        isMassageV1Booking &&
                        !massageV1ConfigReady)
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
                      isCleaningV1PreviewOnly ||
                      isMassageV1PreviewOnly ||
                      (service === "repair" && hasFailedPhotos) ||
                      (service === "repair" &&
                        uploadedPhotoCount === 0 &&
                        !allowWithoutPhotos)
                    }
                    className="havenly-control flex-1 bg-olive px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-olive-deep disabled:opacity-60"
                  >
                    {sending
                      ? t("sending")
                      : isCleaningV1PreviewOnly
                        ? t("cleaningV1PreviewSubmitDisabled")
                        : isMassageV1PreviewOnly
                          ? t("massageV1PreviewSubmitDisabled")
                          : service === "repair" ||
                              (isCleaningV1Booking &&
                                cleaningV1Estimate?.status === "quote")
                            ? t("requestQuote")
                            : t("confirmPrice", {
                                price: formatEuro(
                                  isCleaningV1Booking &&
                                    cleaningV1Estimate?.status === "fixed" &&
                                    cleaningV1Estimate.result
                                      .customerPriceEuro != null
                                    ? cleaningV1Estimate.result
                                        .customerPriceEuro
                                    : (total ?? 0),
                                ),
                              })}
                  </button>
                )}
              </div>
            </div>
          </form>
        )}
        </div>
      </motion.div>
      <WellnessEquipmentModal
        equipmentId={equipmentModalId}
        open={equipmentModalId != null}
        onClose={() => setEquipmentModalId(null)}
        canAdd={
          MASSAGE_V1_EQUIPMENT_UI_BOOKABLE &&
          !isPremiumTariff &&
          equipmentModalId != null &&
          !wellnessEquipmentIds.includes(equipmentModalId)
        }
        alreadyIncluded={isPremiumTariff}
        onAdd={(id) => {
          if (!MASSAGE_V1_EQUIPMENT_UI_BOOKABLE || isPremiumTariff) return;
          setWellnessEquipmentIds((prev) =>
            prev.includes(id) ? prev : [...prev, id],
          );
        }}
      />
    </div>
  );
}
