import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { HOUSE_CAST } from "../house-personas";
import { bundledHouseBody, houseFullBodyUrl, HOUSE_BODY_ART } from "../house-character-art";

test("every fixed House character has an immutable bundled full-body with the approved bytes", () => {
  expect(Object.keys(HOUSE_BODY_ART)).toHaveLength(HOUSE_CAST.length);
  for (const member of HOUSE_CAST) {
    const url = houseFullBodyUrl(member.name, member.personality), art = bundledHouseBody(url);
    expect(art).not.toBeNull();
    const bytes = readFileSync(new URL(`../../../web/public${url}`, import.meta.url));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(art!.sha256);
    expect(art!.height).toBeGreaterThan(art!.width);
    expect(url).toBe(`/avatars/personas/full-body-v1/${member.personality}.webp`);
  }
});

test("bundled image access only accepts exact catalog URLs", () => {
  for (const url of [null, "", "/avatars/personas/full-body-v1/../strategic.webp", "/avatars/personas/full-body-v1/strategic.webp?other=1",
    "file:///etc/passwd", "https://example.test/avatars/personas/full-body-v1/strategic.webp", "/avatars/personas/full-body-v2/strategic.webp"]) {
    expect(bundledHouseBody(url)).toBeNull();
  }
});
