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
  const payload = {
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

  const canonical = canonicalize(payload);
  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}
