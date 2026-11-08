import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !key) {
  console.error("Нет NEXT_PUBLIC_SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const agent = JSON.parse(readFileSync(resolve("data/agent.json"), "utf8"));

const services = [
  {
    id: 1,
    slug: "cleaning",
    title: "Клининг",
    description:
      "Уборка квартир, домов и офисов: поддерживающая, генеральная, после ремонта. Учитываем площадь, состав работ и удобный слот.",
    price_note: "от 45 €",
    is_active: true,
    sort_order: 1,
  },
  {
    id: 2,
    slug: "repair",
    title: "Мелкий ремонт",
    description:
      "Бытовые работы без капитального ремонта: сборка мебели, замена смесителей и розеток, мелкий монтаж, устранение простых неисправностей.",
    price_note: "от 35 € / час",
    is_active: true,
    sort_order: 2,
  },
  {
    id: 3,
    slug: "massage",
    title: "Массажные услуги",
    description:
      "Массаж для расслабления и восстановления: классический, спортивный и другие виды по согласованию. Подбираем формат, длительность и время визита.",
    price_note: "от 50 €",
    is_active: true,
    sort_order: 3,
  },
];

const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const now = new Date().toISOString();

const configResult = await sb.from("projects1_agent_config").upsert({
  id: 1,
  prompt: agent.prompt,
  model: agent.model,
  updated_at: now,
});
console.log("config:", configResult.error ? `ERR ${configResult.error.message}` : "OK");

const servicesResult = await sb
  .from("projects1_services")
  .upsert(services.map((row) => ({ ...row, updated_at: now })));
console.log(
  "services:",
  servicesResult.error
    ? `ERR ${servicesResult.error.code} ${servicesResult.error.message}`
    : "OK",
);

if (!servicesResult.error) {
  const { data } = await sb
    .from("projects1_services")
    .select("id, title")
    .order("sort_order");
  console.log("rows:", data);
}
