import assert from "node:assert/strict";
import { test } from "node:test";
import { toggleWellnessEquipmentId } from "@/lib/massage-wellness-catalog";

test("toggleWellnessEquipmentId adds on first call", () => {
  const next = toggleWellnessEquipmentId([], "foot-system");
  assert.deepEqual(next, ["foot-system"]);
});

test("toggleWellnessEquipmentId removes on second call", () => {
  const once = toggleWellnessEquipmentId([], "moxi");
  const twice = toggleWellnessEquipmentId(once, "moxi");
  assert.deepEqual(once, ["moxi"]);
  assert.deepEqual(twice, []);
});

test("toggleWellnessEquipmentId keeps other selected devices", () => {
  const selected = toggleWellnessEquipmentId(["eye-system"], "top-relax");
  assert.deepEqual(selected, ["eye-system", "top-relax"]);
  const removed = toggleWellnessEquipmentId(selected, "eye-system");
  assert.deepEqual(removed, ["top-relax"]);
});

test("toggleWellnessEquipmentId is idempotent for one-shot UX (no double-toggle)", () => {
  // Regression: a single user gesture must map to exactly one toggle call.
  const afterOneGesture = toggleWellnessEquipmentId([], "foot-system");
  assert.equal(afterOneGesture.includes("foot-system"), true);
  assert.equal(afterOneGesture.length, 1);
});
