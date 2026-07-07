import type { HouseHighlightBackdropCategory } from "@/lib/api";

const BACKDROP_PLATES: Partial<Record<HouseHighlightBackdropCategory, string>> = {
  empty_council_chamber: "/house-highlights/plates/empty-council-chamber.svg",
  jury_wall: "/house-highlights/plates/jury-wall.svg",
  abstract_vote_board: "/house-highlights/plates/abstract-vote-board.svg",
  fractured_alliance_table: "/house-highlights/plates/fractured-alliance-table.svg",
  spotlight_stage: "/house-highlights/plates/spotlight-stage.svg",
  surveillance_board_texture: "/house-highlights/plates/surveillance-board-texture.svg",
};

const BACKDROP_CLASSES: Record<HouseHighlightBackdropCategory, string> = {
  none: "bg-[#111113] bg-[linear-gradient(135deg,#111113,#18181b_48%,#09090b)]",
  empty_council_chamber: "bg-[#18130d] bg-[image:url('/house-highlights/plates/empty-council-chamber.svg'),linear-gradient(160deg,rgba(250,204,21,0.16),transparent_34%),linear-gradient(135deg,#18130d,#27201a_45%,#080706)]",
  jury_wall: "bg-[#101417] bg-[image:url('/house-highlights/plates/jury-wall.svg'),linear-gradient(160deg,rgba(34,211,238,0.14),transparent_36%),linear-gradient(135deg,#101417,#242a2e_50%,#070809)]",
  abstract_vote_board: "bg-[#111114] bg-[image:url('/house-highlights/plates/abstract-vote-board.svg'),linear-gradient(145deg,rgba(244,63,94,0.18),transparent_32%),linear-gradient(215deg,rgba(34,211,238,0.12),transparent_38%),linear-gradient(135deg,#111114,#242025_55%,#09090b)]",
  fractured_alliance_table: "bg-[#101514] bg-[image:url('/house-highlights/plates/fractured-alliance-table.svg'),linear-gradient(155deg,rgba(16,185,129,0.15),transparent_34%),linear-gradient(135deg,#101514,#252927_48%,#080908)]",
  spotlight_stage: "bg-[#151315] bg-[image:url('/house-highlights/plates/spotlight-stage.svg'),linear-gradient(180deg,rgba(255,255,255,0.19),transparent_38%),linear-gradient(135deg,#151315,#27242a_52%,#08070a)]",
  surveillance_board_texture: "bg-[#121313] bg-[image:url('/house-highlights/plates/surveillance-board-texture.svg'),linear-gradient(145deg,rgba(251,146,60,0.14),transparent_34%),linear-gradient(215deg,rgba(34,197,94,0.1),transparent_42%),linear-gradient(135deg,#121313,#242525_50%,#070808)]",
};

export function houseHighlightBackdropClass(category: string): string {
  const backdropClass = BACKDROP_CLASSES[category as HouseHighlightBackdropCategory] ?? BACKDROP_CLASSES.none;
  return `${backdropClass} bg-cover bg-center`;
}

export function houseHighlightBackdropAsset(category: string): string | null {
  return BACKDROP_PLATES[category as HouseHighlightBackdropCategory] ?? null;
}
