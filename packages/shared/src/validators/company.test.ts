import { describe, expect, it } from "vitest";
import { updateCompanySchema } from "./company.js";

describe("company validators", () => {
  it("accepts supported artifact storage defaults and rejects unsupported values", () => {
    expect(updateCompanySchema.parse({ artifactStorage: "nas_minio" })).toEqual({
      artifactStorage: "nas_minio",
    });
    expect(updateCompanySchema.parse({ artifactStorage: "default" })).toEqual({
      artifactStorage: "default",
    });
    expect(updateCompanySchema.safeParse({ artifactStorage: "other" }).success).toBe(false);
  });
});
