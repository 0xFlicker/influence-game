/** Approved, already-transparent bundled references. Versioned URLs are immutable
 * after deployment; freeze them into new rosters instead of consulting live art.
 */
import { getHousePortraitKey, type HousePortraitKey } from "./house-personas";

export const HOUSE_BODY_ART = Object.freeze({
  "honest": {
    "url": "/avatars/personas/full-body-v1/honest.webp",
    "sha256": "38030ff3c74a45cde9fbb92ef878a0c7a03f425c84ff705f6011c1fea698086b",
    "width": 1024,
    "height": 1536
  },
  "strategic": {
    "url": "/avatars/personas/full-body-v1/strategic.webp",
    "sha256": "a7074b175441c2246ae5d5009552933bcdfd18a147e681cdf22fbdfb771c1099",
    "width": 1024,
    "height": 1536
  },
  "deceptive": {
    "url": "/avatars/personas/full-body-v1/deceptive.webp",
    "sha256": "e4967e5fc7eb315cb47ae34ac24c9aa8ef42a4578d5a44f4fc4ca1f3c399a160",
    "width": 1024,
    "height": 1536
  },
  "paranoid": {
    "url": "/avatars/personas/full-body-v1/paranoid.webp",
    "sha256": "18e49fb9fd89004fd7eec3ef326b4a56ce4431902f31b7f94ab78f9f562c8923",
    "width": 1024,
    "height": 1535
  },
  "social": {
    "url": "/avatars/personas/full-body-v1/social.webp",
    "sha256": "b170ad439efc39d36e2bc5a5e8a29f32313301cbd38601d1540c9c0611b3c8e7",
    "width": 1024,
    "height": 1536
  },
  "aggressive": {
    "url": "/avatars/personas/full-body-v1/aggressive.webp",
    "sha256": "e8546a16a4aabbc19e83244525f636429f5d10b9bd76727d27e3191617b4f0d1",
    "width": 1024,
    "height": 1536
  },
  "loyalist": {
    "url": "/avatars/personas/full-body-v1/loyalist.webp",
    "sha256": "104edeeca5b1c0dfe75bc359371aaf53ecb88279da9c0ca77fc7f95b2f313f68",
    "width": 1024,
    "height": 1536
  },
  "observer": {
    "url": "/avatars/personas/full-body-v1/observer.webp",
    "sha256": "f52be461f51cc1ebb1221c0cd499f4ba4a25f7724c79fa3b3448cfdd6d3d4b26",
    "width": 1024,
    "height": 1536
  },
  "diplomat": {
    "url": "/avatars/personas/full-body-v1/diplomat.webp",
    "sha256": "9e9984c2d24c77adb2a55e183c4d87dd2eaafec2ebcc52a454bba90df15a9e77",
    "width": 1024,
    "height": 1536
  },
  "wildcard": {
    "url": "/avatars/personas/full-body-v1/wildcard.webp",
    "sha256": "1ea1698773a63a7c195b5484df52ef02899f57b01c45b167d26b85961f80a1ca",
    "width": 1024,
    "height": 1536
  },
  "contrarian": {
    "url": "/avatars/personas/full-body-v1/contrarian.webp",
    "sha256": "005b2f79ba4dd5a685bca855411d9d1d7dd44c632148fb000d4efb796703526d",
    "width": 1024,
    "height": 1536
  },
  "provocateur": {
    "url": "/avatars/personas/full-body-v1/provocateur.webp",
    "sha256": "8f7bc5389292739c470dc759ce13f2d99443fd3333691344434b76489c3e9917",
    "width": 1024,
    "height": 1536
  },
  "martyr": {
    "url": "/avatars/personas/full-body-v1/martyr.webp",
    "sha256": "a320b91fe7610b6fcac83bd6b3734d8aa074f339b0e5d914fdde43052fbd4f08",
    "width": 1024,
    "height": 1536
  },
  "broker": {
    "url": "/avatars/personas/full-body-v1/broker.webp",
    "sha256": "2a91e1806c7a6b73ad0eb328d8861207d4ef94bfcea442527ac665eddc3a568b",
    "width": 1024,
    "height": 1536
  }
} as const satisfies Record<HousePortraitKey, { url: string; sha256: string; width: number; height: number }>);

export function houseFullBodyUrl(name: string, personaKey?: string | null): string {
  return HOUSE_BODY_ART[getHousePortraitKey(name, personaKey)].url;
}

/** Exact catalog match only: never turn a supplied URL into an arbitrary disk path. */
export function bundledHouseBody(url: unknown) {
  return typeof url === "string" ? Object.values(HOUSE_BODY_ART).find(art => art.url === url) ?? null : null;
}
