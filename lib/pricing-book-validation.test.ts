import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertActivePricingConfig,
  buildActivePricingBook,
} from "./pricing-book-validation";

test("buildActivePricingBook accepts a valid active pricing book", () => {
  const configs = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      version: 1,
      status: "active",
      cleaning_hourly_rate_euro: 20,
    },
  ];

  const config = assertActivePricingConfig(configs, null);

  const planRows = [
    { rooms: 1, hours: 2, workers: 1, pricing_config_id: config.id },
    { rooms: 2, hours: 3, workers: 1, pricing_config_id: config.id },
    { rooms: 3, hours: 4, workers: 2, pricing_config_id: config.id },
    { rooms: 4, hours: 5, workers: 2, pricing_config_id: config.id },
    { rooms: 5, hours: 6, workers: 3, pricing_config_id: config.id },
    { rooms: 6, hours: 6, workers: 3, pricing_config_id: config.id },
  ];

  const massageRows = [
    { minutes: 60, price_euro: 45, is_active: true, pricing_config_id: config.id },
    { minutes: 90, price_euro: 67.5, is_active: true, pricing_config_id: config.id },
    { minutes: 120, price_euro: 90, is_active: true, pricing_config_id: config.id },
  ];

  const book = buildActivePricingBook(config, planRows, null, massageRows, null);

  assert.equal(book.id, "11111111-1111-4111-8111-111111111111");
  assert.equal(book.version, 1);
  assert.equal(book.cleaningHourlyRateEuro, 20);
  assert.deepEqual(book.roomPlans, [
    { rooms: 1, hours: 2, workers: 1 },
    { rooms: 2, hours: 3, workers: 1 },
    { rooms: 3, hours: 4, workers: 2 },
    { rooms: 4, hours: 5, workers: 2 },
    { rooms: 5, hours: 6, workers: 3 },
    { rooms: 6, hours: 6, workers: 3 },
  ]);
  assert.deepEqual(book.massagePrices, [
    { minutes: 60, priceEuro: 45, isActive: true },
    { minutes: 90, priceEuro: 67.5, isActive: true },
    { minutes: 120, priceEuro: 90, isActive: true },
  ]);
});

test("assertActivePricingConfig rejects invalid cleaning hourly rates", () => {
  const invalidRates = [0, -1, null, "20.000"] as const;

  for (const cleaning_hourly_rate_euro of invalidRates) {
    assert.throws(() => {
      assertActivePricingConfig(
        [
          {
            id: "11111111-1111-4111-8111-111111111111",
            version: 1,
            status: "active",
            cleaning_hourly_rate_euro,
          },
        ],
        null,
      );
    });
  }
});

test("buildActivePricingBook rejects missing or inactive required massage prices", () => {
  const config = assertActivePricingConfig(
    [
      {
        id: "11111111-1111-4111-8111-111111111111",
        version: 1,
        status: "active",
        cleaning_hourly_rate_euro: 20,
      },
    ],
    null,
  );

  const planRows = [
    { rooms: 1, hours: 2, workers: 1, pricing_config_id: config.id },
    { rooms: 2, hours: 3, workers: 1, pricing_config_id: config.id },
    { rooms: 3, hours: 4, workers: 2, pricing_config_id: config.id },
    { rooms: 4, hours: 5, workers: 2, pricing_config_id: config.id },
    { rooms: 5, hours: 6, workers: 3, pricing_config_id: config.id },
    { rooms: 6, hours: 6, workers: 3, pricing_config_id: config.id },
  ];

  assert.throws(() => {
    buildActivePricingBook(
      config,
      planRows,
      null,
      [
        { minutes: 60, price_euro: 45, is_active: true, pricing_config_id: config.id },
        { minutes: 120, price_euro: 90, is_active: true, pricing_config_id: config.id },
      ],
      null,
    );
  });

  assert.throws(() => {
    buildActivePricingBook(
      config,
      planRows,
      null,
      [
        { minutes: 60, price_euro: 45, is_active: true, pricing_config_id: config.id },
        { minutes: 90, price_euro: 67.5, is_active: true, pricing_config_id: config.id },
        { minutes: 120, price_euro: 90, is_active: false, pricing_config_id: config.id },
      ],
      null,
    );
  });
});

test("buildActivePricingBook rejects missing or duplicate cleaning room plans", () => {
  const config = assertActivePricingConfig(
    [
      {
        id: "11111111-1111-4111-8111-111111111111",
        version: 1,
        status: "active",
        cleaning_hourly_rate_euro: 20,
      },
    ],
    null,
  );

  const massageRows = [
    { minutes: 60, price_euro: 45, is_active: true, pricing_config_id: config.id },
    { minutes: 90, price_euro: 67.5, is_active: true, pricing_config_id: config.id },
    { minutes: 120, price_euro: 90, is_active: true, pricing_config_id: config.id },
  ];

  assert.throws(() => {
    buildActivePricingBook(
      config,
      [
        { rooms: 1, hours: 2, workers: 1, pricing_config_id: config.id },
        { rooms: 2, hours: 3, workers: 1, pricing_config_id: config.id },
        { rooms: 4, hours: 5, workers: 2, pricing_config_id: config.id },
        { rooms: 5, hours: 6, workers: 3, pricing_config_id: config.id },
        { rooms: 6, hours: 6, workers: 3, pricing_config_id: config.id },
      ],
      null,
      massageRows,
      null,
    );
  });

  assert.throws(() => {
    buildActivePricingBook(
      config,
      [
        { rooms: 1, hours: 2, workers: 1, pricing_config_id: config.id },
        { rooms: 2, hours: 3, workers: 1, pricing_config_id: config.id },
        { rooms: 3, hours: 4, workers: 2, pricing_config_id: config.id },
        { rooms: 3, hours: 4, workers: 2, pricing_config_id: config.id },
        { rooms: 4, hours: 5, workers: 2, pricing_config_id: config.id },
        { rooms: 5, hours: 6, workers: 3, pricing_config_id: config.id },
        { rooms: 6, hours: 6, workers: 3, pricing_config_id: config.id },
      ],
      null,
      massageRows,
      null,
    );
  });
});

test("pricing validation rejects Supabase query errors", () => {
  const queryError = new Error("simulated query failure");

  assert.throws(() => {
    assertActivePricingConfig(null, queryError);
  }, Error);

  const config = assertActivePricingConfig(
    [
      {
        id: "11111111-1111-4111-8111-111111111111",
        version: 1,
        status: "active",
        cleaning_hourly_rate_euro: 20,
      },
    ],
    null,
  );

  const planRows = [
    { rooms: 1, hours: 2, workers: 1, pricing_config_id: config.id },
    { rooms: 2, hours: 3, workers: 1, pricing_config_id: config.id },
    { rooms: 3, hours: 4, workers: 2, pricing_config_id: config.id },
    { rooms: 4, hours: 5, workers: 2, pricing_config_id: config.id },
    { rooms: 5, hours: 6, workers: 3, pricing_config_id: config.id },
    { rooms: 6, hours: 6, workers: 3, pricing_config_id: config.id },
  ];

  const massageRows = [
    { minutes: 60, price_euro: 45, is_active: true, pricing_config_id: config.id },
    { minutes: 90, price_euro: 67.5, is_active: true, pricing_config_id: config.id },
    { minutes: 120, price_euro: 90, is_active: true, pricing_config_id: config.id },
  ];

  assert.throws(() => {
    buildActivePricingBook(config, planRows, queryError, massageRows, null);
  }, Error);

  assert.throws(() => {
    buildActivePricingBook(config, planRows, null, massageRows, queryError);
  }, Error);
});
