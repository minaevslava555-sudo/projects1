import { cleanupOrphanRepairPhotos } from "@/lib/repair-photos-cleanup";

export const runtime = "nodejs";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  return header === `Bearer ${secret}`;
}

async function runCleanup(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await cleanupOrphanRepairPhotos({ limit: 80 });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cleanup failed";
    console.error("[cron/cleanup-repair-photos]", message);
    return Response.json({ ok: false, error: "Cleanup failed" }, { status: 502 });
  }
}

export async function GET(request: Request) {
  return runCleanup(request);
}

export async function POST(request: Request) {
  return runCleanup(request);
}
