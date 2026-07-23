import { describe, expect, test } from "bun:test";
import {
  HOUSE_HIGHLIGHTS_TRAILER_ROSTER_COLUMNS,
  trailerAgentNameStyle,
} from "../remotion/house-highlights-trailer/composition";

describe("HouseHighlightsTrailerComposition", () => {
  test("uses four roster columns so cast names have enough room", () => {
    expect(HOUSE_HIGHLIGHTS_TRAILER_ROSTER_COLUMNS).toBe(4);
  });

  test("wraps and ellipsizes long cast names inside their cards", () => {
    expect(trailerAgentNameStyle(2)).toMatchObject({
      overflow: "hidden",
      overflowWrap: "anywhere",
      textOverflow: "ellipsis",
      display: "-webkit-box",
      WebkitBoxOrient: "vertical",
      WebkitLineClamp: 2,
    });
  });
});
