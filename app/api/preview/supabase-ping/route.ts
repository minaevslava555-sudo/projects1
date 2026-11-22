import { getSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const EXPECTED_HOST = "avyerjnzfsqgaascltqi.supabase.co";
const EXPECTED_REF = "feature/85h-gallery-motion-prototype";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function jsonBooleans(
  body: { ok: boolean; projectRefMatch: boolean; readOk: boolean },
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

function hostnameMatchesExpected(): boolean {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" && parsed.hostname === EXPECTED_HOST;
  } catch {
    return false;
  }
}

/** Temporary Preview-only read-only ping. Remove after Cleaning v1 isolation check. */
export async function GET() {
  if (!previewGateOpen()) {
    return new Response(null, { status: 404, headers: NO_STORE });
  }

  const projectRefMatch = hostnameMatchesExpected();
  if (!projectRefMatch) {
    return jsonBooleans({
      ok: false,
      projectRefMatch: false,
      readOk: false,
    });
  }

  try {
    const supabase = getSupabaseServer();
    const { error } = await supabase
      .from("projects1_orders")
      .select("id", { count: "exact", head: true });

    if (error) {
      return jsonBooleans({
        ok: false,
        projectRefMatch: true,
        readOk: false,
      });
    }

    return jsonBooleans({
      ok: true,
      projectRefMatch: true,
      readOk: true,
    });
  } catch {
    return jsonBooleans({
      ok: false,
      projectRefMatch: true,
      readOk: false,
    });
  }
}
