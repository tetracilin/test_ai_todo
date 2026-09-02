import { describe, expect, it } from "vitest";
import { HttpError } from "../errors.js";
import { normalizeNasFolder } from "../services/minio-nas-storage.js";

describe("MinIO NAS folder validation", () => {
  it("normalizes valid absolute POSIX paths", () => {
    expect(normalizeNasFolder(" /projects//alpha/ ")).toBe("/projects/alpha");
    expect(normalizeNasFolder("/")).toBe("/");
  });

  it.each(["projects/alpha", "/projects/../secrets", "/projects\\alpha", "/./"]) (
    "rejects unsafe folder %s",
    (folder) => {
      expect(() => normalizeNasFolder(folder)).toThrow(HttpError);
      try {
        normalizeNasFolder(folder);
      } catch (error) {
        expect(error).toMatchObject({ status: 422, details: { code: "INVALID_NAS_FOLDER" } });
      }
    },
  );
});