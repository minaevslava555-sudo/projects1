import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { MASSAGE_V1_TARIFFS } from "@/lib/massage-wellness-catalog";
import {
  formatIncludedEquipmentItems,
  isPremiumWellnessTariff,
  premiumCatalogIncludedEquipment,
} from "@/lib/massage-wellness-presentation";

const DISPLAY_NAMES: Record<string, string> = {
  "foot-system": "FootSystem",
  "eye-system": "EyeSystem",
  moxi: "Moxi",
  "top-relax": "TopRelax",
};

test("Premium Wellness is detected only for premium-wellness-120", () => {
  assert.equal(isPremiumWellnessTariff("premium-wellness-120"), true);
  assert.equal(isPremiumWellnessTariff("relaxing-60"), false);
  assert.equal(isPremiumWellnessTariff(null), false);
});

test("Premium included equipment list comes from catalog order", () => {
  assert.deepEqual(premiumCatalogIncludedEquipment(), [
    "foot-system",
    "eye-system",
    "moxi",
    "top-relax",
  ]);
  assert.deepEqual(
    MASSAGE_V1_TARIFFS["premium-wellness-120"].includedEquipment,
    premiumCatalogIncludedEquipment(),
  );
});

test("formatIncludedEquipmentItems uses catalog ids and display names", () => {
  const items = formatIncludedEquipmentItems(
    premiumCatalogIncludedEquipment(),
    (id) => DISPLAY_NAMES[id] ?? id,
  );
  assert.equal(items, "FootSystem, EyeSystem, Moxi, TopRelax");
});

test("EN and pt-PT Premium UX copy keys stay aligned", () => {
  const en = JSON.parse(
    readFileSync(path.join(process.cwd(), "messages/en.json"), "utf8"),
  ) as {
    BookingWizard: Record<string, string>;
  };
  const pt = JSON.parse(
    readFileSync(path.join(process.cwd(), "messages/pt-PT.json"), "utf8"),
  ) as {
    BookingWizard: Record<string, string>;
  };

  assert.equal(
    en.BookingWizard.massageV1PremiumTotalDuration,
    "Total wellness session: {minutes} min",
  );
  assert.equal(
    pt.BookingWizard.massageV1PremiumTotalDuration,
    "Duração total da sessão de bem-estar: {minutes} min",
  );
  assert.match(
    en.BookingWizard.massageV1PremiumSummaryVisit,
    /Total wellness session: \{minutes\} min · \{total\}/,
  );
  assert.match(
    pt.BookingWizard.massageV1PremiumSummaryVisit,
    /Duração total da sessão de bem-estar: \{minutes\} min · \{total\}/,
  );
  assert.equal(
    en.BookingWizard.massageV1IncludedEquipmentInPrice,
    "Included in the price: {items}",
  );
  assert.equal(
    pt.BookingWizard.massageV1IncludedEquipmentInPrice,
    "Incluído no preço: {items}",
  );
  assert.equal(
    en.BookingWizard.massageV1BaseDuration,
    "Massage duration: {minutes} min",
  );
  assert.equal(
    pt.BookingWizard.massageV1BaseDuration,
    "Duração da massagem: {minutes} min",
  );
});
