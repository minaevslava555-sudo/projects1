import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  MASSAGE_WELLNESS_BLUR,
  massageWellnessBlur,
} from "@/lib/massage-wellness-blur";

const REQUIRED = [
  "/images/massage-relaxing.webp",
  "/images/massage-back.webp",
  "/images/massage-legs.webp",
  "/images/massage-premium.webp",
  "/images/wellness/foot-system.webp",
  "/images/wellness/foot-system-device.webp",
  "/images/wellness/eye-system.webp",
  "/images/wellness/eye-system-device.webp",
  "/images/wellness/moxi.webp",
  "/images/wellness/moxi-device.webp",
  "/images/wellness/top-relax.webp",
  "/images/wellness/top-relax-device.webp",
] as const;

function publicFileSha256(publicPath: string): string {
  const absolute = path.join(process.cwd(), "public", publicPath.replace(/^\//, ""));
  const bytes = readFileSync(absolute);
  return createHash("sha256").update(bytes).digest("hex");
}

test("blur map covers all 12 massage/wellness presentation assets", () => {
  assert.equal(Object.keys(MASSAGE_WELLNESS_BLUR).length, REQUIRED.length);
  for (const src of REQUIRED) {
    const blur = massageWellnessBlur(src);
    assert.ok(blur, `missing blur for ${src}`);
    assert.match(blur, /^data:image\/jpeg;base64,/);
    assert.ok(blur.length > 80, `blur too short for ${src}`);
  }
});

test("unknown image paths have no blur entry", () => {
  assert.equal(massageWellnessBlur("/images/missing.webp"), undefined);
});

test("different source files must not reuse the same blurDataURL", () => {
  const byHash = new Map<string, string>();
  const collisions: string[] = [];

  for (const src of REQUIRED) {
    const fileHash = publicFileSha256(src);
    const blur = massageWellnessBlur(src);
    assert.ok(blur);

    const previous = byHash.get(fileHash);
    if (previous == null) {
      byHash.set(fileHash, blur);
      continue;
    }
    // Identical source bytes may share blur; anything else is a generation bug.
    assert.equal(
      previous,
      blur,
      `same source hash unexpectedly produced different blurs for ${src}`,
    );
  }

  const paths = [...REQUIRED];
  for (let i = 0; i < paths.length; i += 1) {
    for (let j = i + 1; j < paths.length; j += 1) {
      const a = paths[i];
      const b = paths[j];
      const hashA = publicFileSha256(a);
      const hashB = publicFileSha256(b);
      const blurA = massageWellnessBlur(a);
      const blurB = massageWellnessBlur(b);
      assert.ok(blurA && blurB);

      if (hashA !== hashB && blurA === blurB) {
        collisions.push(`${a} == ${b}`);
      }
      if (hashA === hashB) {
        assert.equal(
          blurA,
          blurB,
          `identical originals must share blur: ${a} vs ${b}`,
        );
      }
    }
  }

  assert.deepEqual(
    collisions,
    [],
    `distinct originals reused blurDataURL:\n${collisions.join("\n")}`,
  );
});

test("four tariff photos are distinct assets with distinct blurs", () => {
  const tariffs = [
    "/images/massage-relaxing.webp",
    "/images/massage-back.webp",
    "/images/massage-legs.webp",
    "/images/massage-premium.webp",
  ] as const;

  const hashes = tariffs.map((src) => publicFileSha256(src));
  const blurs = tariffs.map((src) => massageWellnessBlur(src));

  assert.equal(new Set(hashes).size, 4);
  assert.equal(new Set(blurs).size, 4);
});
