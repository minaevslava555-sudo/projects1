import { createHash } from "crypto";

/** Normalized booking fields after handler validation (customer-supplied only). */
export type OrderRequestFingerprintInput = {
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

/**
 * Deterministic SHA-256 fingerprint of validated customer booking data.
 * Does not log inputs. Excludes IDs, tokens, Turnstile, Redis, and pricing.
 */
export function buildOrderRequestFingerprint(
  input: OrderRequestFingerprintInput,
): string {
  const repairPhotoPaths =
    input.repairPhotoPaths == null
      ? null
      : [...input.repairPhotoPaths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  // Fixed key set so missing optional fields are represented as null, not omitted.
  // Cleaning v1 keys are appended only for cleaning + version "v1" so legacy digests stay byte-identical.
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

  const canonical = canonicalize(payload);
  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}
