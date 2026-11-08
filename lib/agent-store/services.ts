import { getSupabaseServer, supabaseEnv } from "../supabase/server";

export type ServiceItem = {
  id: number;
  slug: string;
  title: string;
  description: string;
  priceNote: string;
};

const FALLBACK_SERVICES: ServiceItem[] = [
  {
    id: 1,
    slug: "cleaning",
    title: "Клининг",
    description:
      "Уборка квартир, домов и офисов: поддерживающая, генеральная, после ремонта. Учитываем площадь, состав работ и удобный слот.",
    priceNote: "от 45 €",
  },
  {
    id: 2,
    slug: "repair",
    title: "Мелкий ремонт",
    description:
      "Бытовые работы без капитального ремонта: сборка мебели, замена смесителей и розеток, мелкий монтаж, устранение простых неисправностей.",
    priceNote: "от 35 € / час",
  },
  {
    id: 3,
    slug: "massage",
    title: "Массажные услуги",
    description:
      "Массаж для расслабления и восстановления: классический, спортивный и другие виды по согласованию. Подбираем формат, длительность и время визита.",
    priceNote: "от 50 €",
  },
];

export async function listActiveServices(): Promise<ServiceItem[]> {
  if (!supabaseEnv()) return FALLBACK_SERVICES;

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("projects1_services")
    .select("id, slug, title, description, price_note")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error || !data?.length) return FALLBACK_SERVICES;

  return data.map((row) => ({
    id: Number(row.id),
    slug: String(row.slug),
    title: String(row.title),
    description: String(row.description),
    priceNote: String(row.price_note ?? "стоимость уточняется при расчёте"),
  }));
}

export function formatServicesForPrompt(services: ServiceItem[]): string {
  if (!services.length) return "";
  const lines = services.map(
    (service, index) =>
      `${index + 1}. ${service.title}: ${service.description} Цена: ${service.priceNote}.`,
  );
  return `Каталог услуг компании:\n${lines.join("\n")}`;
}
