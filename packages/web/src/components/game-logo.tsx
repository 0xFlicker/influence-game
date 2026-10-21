/* eslint-disable @next/next/no-img-element -- Packaged identity assets shared across game surfaces. */
import { GAME_BRANDS, type BrandedGame } from "@/lib/game-brand";

export function GameLogo({ game, className, decorative = false }: {
  game: BrandedGame; className?: string; decorative?: boolean;
}) {
  const brand = GAME_BRANDS[game];
  return <img src={brand.logo} width={brand.width} height={brand.height}
    alt={decorative ? "" : brand.name} className={className} />;
}
