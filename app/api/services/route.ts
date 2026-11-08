import { listActiveServices } from "@/lib/agent-store";

export async function GET() {
  try {
    const services = await listActiveServices();
    return Response.json({
      services: services.map((service) => ({
        id: service.id,
        slug: service.slug,
        title: service.title,
        description: service.description,
        price_note: service.priceNote,
      })),
    });
  } catch {
    return Response.json({ error: "Не удалось загрузить услуги" }, { status: 502 });
  }
}
