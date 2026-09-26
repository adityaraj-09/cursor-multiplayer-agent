import { describe, expect, it } from "vitest";
import {
  errorMessage,
  stringifyUnknown,
} from "../shared/stringifyUnknown.js";

describe("stringifyUnknown", () => {
  it("extracts message from Error, nested objects, and arrays", () => {
    expect(stringifyUnknown("hello")).toBe("hello");
    expect(stringifyUnknown(new Error("boom"))).toBe("boom");
    expect(stringifyUnknown({ message: "rate limited" })).toBe("rate limited");
    expect(
      stringifyUnknown({
        error: { message: "invalid api key" },
      }),
    ).toBe("invalid api key");
    expect(
      stringifyUnknown([{ message: "first" }, { message: "second" }]),
    ).toBe("first\nsecond");
  });

  it("never returns [object Object]", () => {
    expect(stringifyUnknown({})).toBe("");
    expect(stringifyUnknown("[object Object]")).toBe("");
    expect(stringifyUnknown(new Error("[object Object]"))).toBe("Error");
    expect(errorMessage({ status: 500, code: "SANDBOX_FAILED" })).toBe(
      JSON.stringify({ status: 500, code: "SANDBOX_FAILED" }),
    );
    expect(errorMessage({})).toBe("Unknown error");
  });
});
