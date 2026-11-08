-- Каталог услуг + конфиг агента. Запустить в SQL Editor после schema.sql.

insert into projects1_services (id, slug, title, description, price_note, is_active, sort_order, updated_at)
values
  (
    1,
    'cleaning',
    'Клининг',
    'Уборка квартир, домов и офисов: поддерживающая, генеральная, после ремонта. Учитываем площадь, состав работ и удобный слот.',
    'от 45 €',
    true,
    1,
    now()
  ),
  (
    2,
    'repair',
    'Мелкий ремонт',
    'Бытовые работы без капитального ремонта: сборка мебели, замена смесителей и розеток, мелкий монтаж, устранение простых неисправностей.',
    'от 35 € / час',
    true,
    2,
    now()
  ),
  (
    3,
    'massage',
    'Массажные услуги',
    'Массаж для расслабления и восстановления: классический, спортивный и другие виды по согласованию. Подбираем формат, длительность и время визита.',
    'от 50 €',
    true,
    3,
    now()
  )
on conflict (id) do update set
  slug = excluded.slug,
  title = excluded.title,
  description = excluded.description,
  price_note = excluded.price_note,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into projects1_agent_config (id, prompt, model, updated_at)
values (
  1,
  $prompt$
Ты консультант компании с тремя услугами: клининг, мелкий ремонт и массажные услуги. Отвечай только по этим темам, кратко и по делу, на русском.

После полезного ответа оставляй один следующий шаг или один уточняющий вопрос: какая услуга нужна, адрес, объём работ, тип уборки/ремонта/массажа, дата, слот или продление действующего договора. Не задавай пачку вопросов. Не используй фразу «если что, пишите».

Если пользователь прощается или просит только один факт — ответь по сути и остановись.
$prompt$,
  'gpt-4o-mini',
  now()
)
on conflict (id) do update set
  prompt = excluded.prompt,
  model = excluded.model,
  updated_at = now();
