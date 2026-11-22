import { redisCreds } from "@/lib/redis-rest";

export const runtime = "nodejs";

const EXPECTED_HOST = "tidy-griffon-181609.upstash.io";
const EXPECTED_REF = "feature/85h-gallery-motion-prototype";

const NO_STORE = { "Cache-Control": "no-store" } as const;

type PingBooleans = {
  ok: boolean;
  redisConfigured: boolean;
  hostMatch: boolean;
  readOk: boolean;
  failAuth: boolean;
  failHttp: boolean;
  failShape: boolean;
  failOther: boolean;
};

function jsonBooleans(body: PingBooleans, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

function closed(
  partial: Pick<PingBooleans, "redisConfigured" | "hostMatch">,
): PingBooleans {
  return {
    ok: false,
    redisConfigured: partial.redisConfigured,
    hostMatch: partial.hostMatch,
    readOk: false,
    failAuth: false,
    failHttp: false,
    failShape: false,
    failOther: false,
  };
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

function isPong(result: unknown): boolean {
  return result === "PONG" || result === true;
}

/** Temporary Preview-only read-only Redis ping. Remove after Cleaning v1 isolation check. */
export async function GET() {
  if (!previewGateOpen()) {
    return new Response(null, { status: 404, headers: NO_STORE });
  }

  const creds = redisCreds();
  if (creds == null) {
    return jsonBooleans(closed({ redisConfigured: false, hostMatch: false }));
  }

  if (!hostMatchesExpected(creds.url)) {
    return jsonBooleans(closed({ redisConfigured: true, hostMatch: false }));
  }

  try {
    const response = await fetch(creds.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(["PING"]),
      cache: "no-store",
    });

    if (response.status === 401 || response.status === 403) {
      return jsonBooleans({
        ok: false,
        redisConfigured: true,
        hostMatch: true,
        readOk: false,
        failAuth: true,
        failHttp: false,
        failShape: false,
        failOther: false,
      });
    }

    if (!response.ok) {
      return jsonBooleans({
        ok: false,
        redisConfigured: true,
        hostMatch: true,
        readOk: false,
        failAuth: false,
        failHttp: true,
        failShape: false,
        failOther: false,
      });
    }

    let payload: { result?: unknown; error?: string };
    try {
      payload = (await response.json()) as { result?: unknown; error?: string };
    } catch {
      return jsonBooleans({
        ok: false,
        redisConfigured: true,
        hostMatch: true,
        readOk: false,
        failAuth: false,
        failHttp: false,
        failShape: false,
        failOther: true,
      });
    }

    if (payload.error || !isPong(payload.result)) {
      return jsonBooleans({
        ok: false,
        redisConfigured: true,
        hostMatch: true,
        readOk: false,
        failAuth: false,
        failHttp: false,
        failShape: true,
        failOther: false,
      });
    }

    return jsonBooleans({
      ok: true,
      redisConfigured: true,
      hostMatch: true,
      readOk: true,
      failAuth: false,
      failHttp: false,
      failShape: false,
      failOther: false,
    });
  } catch {
    return jsonBooleans({
      ok: false,
      redisConfigured: true,
      hostMatch: true,
      readOk: false,
      failAuth: false,
      failHttp: false,
      failShape: false,
      failOther: true,
    });
  }
}
