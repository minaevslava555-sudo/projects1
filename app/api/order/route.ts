import {
  defaultOrderRouteDeps,
  handleOrderPost,
} from "@/lib/order-route-handler";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleOrderPost(request, defaultOrderRouteDeps);
}
