import { describe, expect, it } from "vitest";

import { normalizeSearchText, tokenize } from "./normalize.js";

describe("place search normalization", () => {
  it("folds case, punctuation, and whitespace", () => {
    expect(normalizeSearchText("  Kota   Tua!! ")).toBe("kota tua");
  });

  it("maps Jakarta abbreviations without corrupting display sources", () => {
    expect(normalizeSearchText("Jl. Sudirman")).toBe("jalan sudirman");
    expect(normalizeSearchText("St. Gambir")).toBe("stasiun gambir");
    expect(normalizeSearchText("Ps. Minggu")).toBe("pasar minggu");
    expect(normalizeSearchText("RS Cipto")).toBe("rumah sakit cipto");
  });

  it("preserves Unicode letters after NFKD fold", () => {
    expect(normalizeSearchText("Monas")).toBe("monas");
    expect(tokenize(normalizeSearchText("Grand Indonesia"))).toEqual(["grand", "indonesia"]);
  });
});
