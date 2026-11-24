/**
 * Client-side unresolved booking attempt (sessionStorage).
 * Stores only idempotency key + SHA-256 fingerprint of booking fields — no raw PII.
 */

export const BOOKING_ATTEMPT_STORAGE_KEY = "havenly.bookingAttempt.v1";

export type PersistedBookingAttempt = {
  idempotencyKey: string;
  fingerprint: string;
  service: string;
};

/** Same field set as server OrderRequestFingerprintInput (customer booking data only). */
export type BookingAttemptFingerprintInput = {
  name: string;
  phone: string;
  service: string;
  date: string;
  preferredTime: string;
  streetAddress: string;
  city: string;
  apartmentFloor?: string | null;
  accessInstructions?: string | null;
  details?: string | null;
  problemDescription?: string | null;
  massageCategory?: string | null;
  rooms?: number | null;
  massageMinutes?: number | null;
  repairPhotoPaths?: string[] | null;
  /** Included in hash only when === "v1" and service === "cleaning". */
  cleaningPricingVersion?: string | null;
  roomCounts?: Record<string, unknown> | null;
  cleaningType?: string | null;
  /** Included only when at least one add-on count is > 0 (keeps legacy v1 digests stable). */
  addons?: Record<string, unknown> | null;
};

function canonicalize(value: unknown): unknown {
  if (value === undefined || value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = canonicalize(record[key]);
    }
    return out;
  }
  return value;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Browser/Node Web Crypto SHA-256 fingerprint (aligned with server field set). */
export async function buildBookingAttemptFingerprint(
  input: BookingAttemptFingerprintInput,
): Promise<string> {
  const repairPhotoPaths =
    input.repairPhotoPaths == null
      ? null
      : [...input.repairPhotoPaths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  // Keep in lockstep with buildOrderRequestFingerprint (v1 keys only for cleaning + "v1").
  const payload: Record<string, unknown> = {
    accessInstructions: input.accessInstructions ?? null,
    apartmentFloor: input.apartmentFloor ?? null,
    city: input.city,
    date: input.date,
    details: input.details ?? null,
    massageCategory: input.massageCategory ?? null,
    massageMinutes: input.massageMinutes ?? null,
    name: input.name,
    phone: input.phone,
    preferredTime: input.preferredTime,
    problemDescription: input.problemDescription ?? null,
    repairPhotoPaths,
    rooms: input.rooms ?? null,
    service: input.service,
    streetAddress: input.streetAddress,
  };

  if (input.service === "cleaning" && input.cleaningPricingVersion === "v1") {
    payload.cleaningPricingVersion = "v1";
    payload.cleaningType = input.cleaningType ?? null;
    payload.roomCounts = input.roomCounts ?? null;
    const addons = input.addons;
    if (
      addons != null &&
      typeof addons === "object" &&
      !Array.isArray(addons) &&
      Object.values(addons).some(
        (count) => typeof count === "number" && count > 0,
      )
    ) {
      payload.addons = addons;
    }
  }

  const json = JSON.stringify(canonicalize(payload));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(json),
  );
  return bytesToHex(digest);
}

export function readBookingAttempt(): PersistedBookingAttempt | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(BOOKING_ATTEMPT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedBookingAttempt>;
    if (
      typeof parsed.idempotencyKey !== "string" ||
      !parsed.idempotencyKey ||
      typeof parsed.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/i.test(parsed.fingerprint) ||
      typeof parsed.service !== "string" ||
      !parsed.service
    ) {
      return null;
    }
    return {
      idempotencyKey: parsed.idempotencyKey,
      fingerprint: parsed.fingerprint.toLowerCase(),
      service: parsed.service,
    };
  } catch {
    return null;
  }
}

export function writeBookingAttempt(attempt: PersistedBookingAttempt): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      BOOKING_ATTEMPT_STORAGE_KEY,
      JSON.stringify({
        idempotencyKey: attempt.idempotencyKey,
        fingerprint: attempt.fingerprint.toLowerCase(),
        service: attempt.service,
      }),
    );
  } catch {
    // Quota / private mode — ignore; in-memory key still used for this mount.
  }
}

export function clearBookingAttempt(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(BOOKING_ATTEMPT_STORAGE_KEY);
  } catch {
    // ignore
  }
}
