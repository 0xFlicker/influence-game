import { describe, expect, it } from "bun:test";
import { getHousePortraitGender, getHousePortraitKey, getHousePersonaDetails, HOUSE_CAST, pickHouseCast, restoreHouseCast } from "../house-personas";

describe("House persona prompt defaults", () => {
  it("resolves portrait metadata without inferring an owned character's identity", () => {
    for (const name of ["Jace", "Thane", "Atlas", "Vera"]) {
      for (const key of ["honest", "strategic", "aggressive", "loyalist", "wildcard", "provocateur"]) expect(getHousePortraitGender(name, key)).toBe("male");
      for (const key of ["deceptive", "paranoid", "social", "observer", "diplomat", "contrarian", "martyr"]) expect(getHousePortraitGender(name, key)).toBe("female");
      expect(getHousePortraitKey(name, "broker")).toBe("broker");
      expect(getHousePortraitGender(name, "broker")).toBe("female");
    }
    expect(getHousePortraitKey("Atlas", " STRATEGIC ")).toBe("strategic");
  });

  it("preserves the original authored one-to-one identities", () => {
    expect(Object.fromEntries(HOUSE_CAST.map(member => [member.name, member.personality]))).toEqual({
      Atlas: "strategic", Vera: "deceptive", Finn: "honest", Mira: "social", Rex: "aggressive", Lyra: "paranoid", Kael: "loyalist",
      Echo: "observer", Sage: "diplomat", Jace: "wildcard", Rune: "provocateur", Wren: "martyr", Nyx: "contrarian", Vex: "broker",
    });
    expect(new Set(HOUSE_CAST.map(member => member.personality)).size).toBe(14);
    for (const identity of HOUSE_CAST) expect(identity.gender).toBe(getHousePortraitGender(identity.name, identity.personality));
  });

  it("shuffles complete distinct characters and respects available casting capacity", () => {
    for (let sample = 0; sample < 20; sample++) {
      const cast = pickHouseCast(12, { excludeNames: [" ATLAS ", "Vera"], excludeArchetypes: ["social"] });
      expect(new Set(cast.map(member => member.name)).size).toBe(12);
      expect(cast.some(member => ["Atlas", "Vera"].includes(member.name))).toBe(false);
      expect(cast.at(-1)?.name).toBe("Mira");
      for (const member of cast) expect(HOUSE_CAST).toContain(member);
    }
    expect(pickHouseCast(2, { personaPool: ["strategic", "wildcard"] }).map(member => member.name).sort()).toEqual(["Atlas", "Jace"]);
    expect(() => pickHouseCast(3, { personaPool: ["strategic", "wildcard"] })).toThrow("distinct House characters");
    expect(pickHouseCast(0)).toEqual([]);
  });

  it("restores waiting identities without changing owned names or stealing a later distinct archetype", () => {
    const cast = restoreHouseCast(["strategic", "strategic", "social", "unknown"], ["Vera"]);
    expect(cast.map(member => member.name)).toEqual(["Atlas", "Finn", "Mira", "Rex"]);
    expect(restoreHouseCast(["wildcard", "broker"], []).map(member => member.name)).toEqual(["Jace", "Vex"]);
    expect(restoreHouseCast(["strategic"], ["Atlas"])[0]?.name).toBe("Vera");
    expect(() => restoreHouseCast(["strategic", "strategic"], [], ["strategic"])).toThrow("distinct House characters");
  });

  it("describes the martyr through social-game risk without scapegoat language", () => {
    const martyr = getHousePersonaDetails("martyr");

    expect(martyr.strategyHints).toContain("take blame for allies");
    expect(martyr.strategyHints).not.toContain("scapegoat");
  });
});
