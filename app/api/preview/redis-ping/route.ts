import { redisCommand, redisCreds } from "@/lib/redis-rest";

export const runtime = "nodejs";

const EXPECTED_HOST = "tidy-griffon-181609.upstash.io";
const EXPECTED_REF = "feature/85h-gallery-motion-prototype";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function jsonBooleans(
  body: {
    ok: boolean;
    redisConfigured: boolean;
    hostMatch: boolean;
    readOk: boolean;
  },
  status = 200,
) {
  return Response.json(body, { status, headers: NO_STORE });
}

function previewGateOpen(): boolean {
  return (
    process.env.VERCEL_ENV === "preview" &&
    process.env.VERCEL_GIT_COMMIT_REF === EXPECTED_REF
  );
}

function hostMatchesExpected(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === EXPECTED_HOST;
  } catch {
    return false;
  }
}

/** Temporary Preview-only read-only Redis ping. Remove after Cleaning v1 isolation check. */
export async function GET() {
  if (!previewGateOpen()) {
    return new Response(null, { status: 404, headers: NO_STORE });
  }

  const creds = redisCreds();
  const redisConfigured = creds != null;
  if (!redisConfigured) {
    return jsonBooleans({
      ok: false,
      redisConfigured: false,
      hostMatch: false,
      readOk: false,
    });
  }

  const hostMatch = hostMatchesExpected(creds.url);
  if (!hostMatch) {
    return jsonBooleans({
      ok: false,
      redisConfigured: true,
      hostMatch: false,
      readOk: false,
    });
  }

  try {
    const result = await redisCommand(["PING"]);
    const readOk = result === "PONG" || result === true;
    return jsonBooleans({
      ok: readOk,
      redisConfigured: true,
      hostMatch: true,
      readOk,
    });
  } catch {
    return jsonBooleans({
      ok: false,
      redisConfigured: true,
      hostMatch: true,
      readOk: false,
    });
  }
}
