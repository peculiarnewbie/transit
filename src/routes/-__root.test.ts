import { describe, expect, it } from "vitest";

import { rootHead } from "./__root.js";

describe("root document metadata", () => {
  it("uses the device width for responsive layouts", () => {
    expect(rootHead().meta).toContainEqual({
      name: "viewport",
      content: "width=device-width, initial-scale=1",
    });
  });
});
