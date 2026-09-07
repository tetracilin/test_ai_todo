import { describe, expect, it } from "vitest";
import { sniffAndValidateContentType } from "../services/evidence-provider-minio.js";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const PDF_BYTES = Buffer.from("%PDF-1.7 rest of file", "ascii");
const ZIP_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
const GIF_BYTES = Buffer.from("GIF89a rest", "ascii");
const WEBM_BYTES = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
const TEXT_BYTES = Buffer.from("hello world, this is plain text", "utf8");

function webpBytes(): Buffer {
  const buf = Buffer.alloc(16);
  buf.write("RIFF", 0, "ascii");
  buf.write("WEBP", 8, "ascii");
  return buf;
}

function mp4Bytes(): Buffer {
  const buf = Buffer.alloc(16);
  buf.write("ftyp", 4, "ascii");
  return buf;
}

describe("sniffAndValidateContentType", () => {
  it("accepts bytes that match the declared type for every known signature", () => {
    expect(sniffAndValidateContentType(PNG_BYTES, "image/png")).toBe("image/png");
    expect(sniffAndValidateContentType(JPEG_BYTES, "image/jpeg")).toBe("image/jpeg");
    expect(sniffAndValidateContentType(GIF_BYTES, "image/gif")).toBe("image/gif");
    expect(sniffAndValidateContentType(webpBytes(), "image/webp")).toBe("image/webp");
    expect(sniffAndValidateContentType(PDF_BYTES, "application/pdf")).toBe("application/pdf");
    expect(sniffAndValidateContentType(ZIP_BYTES, "application/zip")).toBe("application/zip");
    expect(
      sniffAndValidateContentType(
        ZIP_BYTES,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(sniffAndValidateContentType(mp4Bytes(), "video/mp4")).toBe("video/mp4");
    expect(sniffAndValidateContentType(WEBM_BYTES, "video/webm")).toBe("video/webm");
  });

  it("refuses a declared image/png whose bytes are something else", () => {
    expect(() => sniffAndValidateContentType(JPEG_BYTES, "image/png")).toThrowError();
  });

  it("refuses a declared application/pdf whose bytes are a PNG", () => {
    expect(() => sniffAndValidateContentType(PNG_BYTES, "application/pdf")).toThrowError();
  });

  it("refuses a declared image/gif whose bytes are plain text", () => {
    expect(() => sniffAndValidateContentType(TEXT_BYTES, "image/gif")).toThrowError();
  });

  it("refuses a content type that is not on the allowlist regardless of bytes", () => {
    expect(() => sniffAndValidateContentType(TEXT_BYTES, "application/x-executable")).toThrowError();
  });

  it("trusts a declared text/plain with no known signature to sniff", () => {
    expect(sniffAndValidateContentType(TEXT_BYTES, "text/plain")).toBe("text/plain");
  });

  it("trusts a declared application/json with plain-text bytes", () => {
    const json = Buffer.from('{"a":1}', "utf8");
    expect(sniffAndValidateContentType(json, "application/json")).toBe("application/json");
  });

  it("refuses a declared text/plain whose bytes are unambiguously a PNG (disguised binary)", () => {
    expect(() => sniffAndValidateContentType(PNG_BYTES, "text/plain")).toThrowError();
  });

  it("refuses a declared application/msword whose bytes are unambiguously a PDF", () => {
    expect(() => sniffAndValidateContentType(PDF_BYTES, "application/msword")).toThrowError();
  });

  it("is case-insensitive on the declared content type", () => {
    expect(sniffAndValidateContentType(PNG_BYTES, "Image/PNG")).toBe("image/png");
  });
});
