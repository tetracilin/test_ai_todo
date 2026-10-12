import { describe, expect, it } from "vitest";
import { inferOpenAiCompatibleBiller } from "./billing.js";

describe("inferOpenAiCompatibleBiller", () => {
  it("returns openrouter when OPENROUTER_API_KEY is present", () => {
    expect(
      inferOpenAiCompatibleBiller({ OPENROUTER_API_KEY: "sk-or-123" } as NodeJS.ProcessEnv, "openai"),
    ).toBe("openrouter");
  });

  it("returns openrouter when OPENAI_BASE_URL points at OpenRouter", () => {
    expect(
      inferOpenAiCompatibleBiller(
        { OPENAI_BASE_URL: "https://openrouter.ai/api/v1" } as NodeJS.ProcessEnv,
        "openai",
      ),
    ).toBe("openrouter");
  });

  it("returns fallback when no OpenRouter markers are present", () => {
    expect(
      inferOpenAiCompatibleBiller(
        { OPENAI_BASE_URL: "https://api.openai.com/v1" } as NodeJS.ProcessEnv,
        "openai",
      ),
    ).toBe("openai");
  });

  it("detects OpenRouter from the alternate OPENAI_API_BASE and OPENAI_API_BASE_URL variables", () => {
    expect(
      inferOpenAiCompatibleBiller({ OPENAI_API_BASE: "https://OpenRouter.ai/api/v1" } as NodeJS.ProcessEnv, "openai"),
    ).toBe("openrouter");
    expect(
      inferOpenAiCompatibleBiller(
        { OPENAI_API_BASE_URL: "https://openrouter.ai/api/v1" } as NodeJS.ProcessEnv,
        "openai",
      ),
    ).toBe("openrouter");
  });

  it("ignores a blank OPENROUTER_API_KEY and returns the fallback", () => {
    expect(
      inferOpenAiCompatibleBiller({ OPENROUTER_API_KEY: "   " } as NodeJS.ProcessEnv, "openai"),
    ).toBe("openai");
  });

  it("returns the supplied fallback, including null, when the env is empty", () => {
    expect(inferOpenAiCompatibleBiller({} as NodeJS.ProcessEnv, "custom-biller")).toBe("custom-biller");
    expect(inferOpenAiCompatibleBiller({} as NodeJS.ProcessEnv, null)).toBeNull();
    expect(inferOpenAiCompatibleBiller({} as NodeJS.ProcessEnv)).toBe("openai");
  });
});
