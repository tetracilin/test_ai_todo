import { describe, expect, it } from "vitest";
import { buildNasEvidenceTarget } from "../services/evidence-provider-nas.js";

describe("buildNasEvidenceTarget", () => {
  it("accepts a NAS UNC-style path with no url", () => {
    const target = buildNasEvidenceTarget({
      providerKey: "nas",
      objectType: "path",
      externalId: "//nas-t3/hosoky/2026/PC-142/bien-ban-nghiem-thu.pdf",
      displayTitle: "Bien ban nghiem thu (NAS)",
    });
    expect(target).toEqual({
      providerKey: "nas",
      objectType: "path",
      externalId: "//nas-t3/hosoky/2026/PC-142/bien-ban-nghiem-thu.pdf",
      displayTitle: "Bien ban nghiem thu (NAS)",
      url: null,
    });
  });

  it("accepts a Windows-style absolute path", () => {
    const target = buildNasEvidenceTarget({
      providerKey: "nas",
      objectType: "path",
      externalId: "C:\\nas\\evidence\\a.pdf",
    });
    expect(target).toMatchObject({ externalId: "C:\\nas\\evidence\\a.pdf", url: null });
  });

  it("defaults displayTitle to the path when none is given", () => {
    const target = buildNasEvidenceTarget({
      providerKey: "nas",
      objectType: "path",
      externalId: "/nas/evidence/a.pdf",
    });
    expect(target).toMatchObject({ displayTitle: "/nas/evidence/a.pdf" });
  });

  it("trims the path", () => {
    const target = buildNasEvidenceTarget({
      providerKey: "nas",
      objectType: "path",
      externalId: "  /nas/evidence/a.pdf  ",
    });
    expect(target).toMatchObject({ externalId: "/nas/evidence/a.pdf" });
  });

  it("refuses a descriptor carrying a url -- no bytes leave the NAS", () => {
    expect(() =>
      buildNasEvidenceTarget({
        providerKey: "nas",
        objectType: "path",
        externalId: "/nas/evidence/a.pdf",
        url: "https://nas.internal/a.pdf",
      }),
    ).toThrowError();
  });

  it("refuses an empty path", () => {
    expect(() =>
      buildNasEvidenceTarget({ providerKey: "nas", objectType: "path", externalId: "   " }),
    ).toThrowError();
  });

  it("refuses a relative path", () => {
    expect(() =>
      buildNasEvidenceTarget({ providerKey: "nas", objectType: "path", externalId: "evidence/a.pdf" }),
    ).toThrowError();
  });
});
