import { describe, expect, it } from "vitest";
import {
  REDACTED_COMMAND_TEXT_VALUE,
  redactCommandText,
  redactDiagnosticText,
} from "./command-redaction.js";

describe("redactCommandText", () => {
  it("returns text with no secret-shaped content unchanged", () => {
    expect(redactCommandText("ls -la /workspace")).toBe("ls -la /workspace");
  });

  it("redacts a CLI secret option value in both space and equals forms", () => {
    const spaced = redactCommandText("tool --api-key sk-live-value-1234 run");
    expect(spaced).not.toContain("sk-live-value-1234");
    expect(spaced).toContain(`--api-key ${REDACTED_COMMAND_TEXT_VALUE}`);
    const equals = redactCommandText("tool --token=opaque-token-value run");
    expect(equals).not.toContain("opaque-token-value");
    expect(equals).toContain(`--token=${REDACTED_COMMAND_TEXT_VALUE}`);
  });

  it("redacts an Authorization bearer header but keeps the scheme", () => {
    const output = redactCommandText('curl -H "Authorization: Bearer opaque-bearer-value" https://x.test');
    expect(output).not.toContain("opaque-bearer-value");
    expect(output).toContain(`Authorization: Bearer ${REDACTED_COMMAND_TEXT_VALUE}`);
  });

  it("redacts well-known provider token shapes found anywhere in the text", () => {
    const openAiKey = "sk-abcdefghijklmnop123456";
    const githubToken = `ghp_${"a".repeat(24)}`;
    const output = redactCommandText(`echo ${openAiKey} ${githubToken}`);
    expect(output).not.toContain(openAiKey);
    expect(output).not.toContain(githubToken);
  });

  it("uses a caller-supplied replacement value", () => {
    expect(redactCommandText("API_KEY=abc123", "<hidden>")).toBe("API_KEY=<hidden>");
  });
});

describe("redactDiagnosticText", () => {
  it("redacts a JSON secret field value", () => {
    const input = '{"token":"opaque-value","status":"error"}';
    const output = redactDiagnosticText(input);
    expect(output).not.toContain("opaque-value");
    expect(output).toContain(`"token":"${REDACTED_COMMAND_TEXT_VALUE}"`);
    // The non-secret field keeps its value.
    expect(output).toContain('"status":"error"');
  });

  it("redacts an api_key JSON field with whitespace around the colon", () => {
    const input = '{ "api_key" : "sk-secret-123" }';
    const output = redactDiagnosticText(input);
    expect(output).not.toContain("sk-secret-123");
    expect(output).toContain(REDACTED_COMMAND_TEXT_VALUE);
  });

  it("redacts an escaped-JSON secret field value", () => {
    // A diagnostic can carry a JSON string, so the double quotes appear as `\"`.
    const input = '{\\"token\\":\\"opaque-value\\"}';
    const output = redactDiagnosticText(input);
    expect(output).not.toContain("opaque-value");
    expect(output).toContain(`\\"token\\":\\"${REDACTED_COMMAND_TEXT_VALUE}\\"`);
  });

  it("still redacts a shell KEY=value secret", () => {
    const input = "ANTHROPIC_API_KEY=super-secret-value claude --print";
    const output = redactDiagnosticText(input);
    expect(output).not.toContain("super-secret-value");
    expect(output).toContain(REDACTED_COMMAND_TEXT_VALUE);
  });

  it("keeps non-secret text and non-secret JSON fields intact", () => {
    const input = '{"status":"ok","message":"probe finished"}';
    expect(redactDiagnosticText(input)).toBe(input);
  });

  it("redacts the secret but keeps a non-secret marker in the same string", () => {
    const input = 'DIAGMARKER1234 said {"authorization":"Bearer opaque"}';
    const output = redactDiagnosticText(input);
    expect(output).toContain("DIAGMARKER1234");
    expect(output).not.toContain("opaque");
  });

  it("redacts a JSON secret value that contains an escaped quote", () => {
    // The value holds an escaped quote, so a naive matcher stops at the `\"` and
    // leaves the rest of the credential. The marker sits after the escaped quote.
    const input = '{"token":"pre\\"MARKERQUOTE_A"}';
    const output = redactDiagnosticText(input);
    expect(output).not.toContain("MARKERQUOTE_A");
    expect(output).toContain(`"token":"${REDACTED_COMMAND_TEXT_VALUE}"`);
  });

  it("redacts a JSON secret value that contains an escaped backslash", () => {
    const input = '{"secret":"pre\\\\MARKERBACKSLASH_A"}';
    const output = redactDiagnosticText(input);
    expect(output).not.toContain("MARKERBACKSLASH_A");
    expect(output).toContain(`"secret":"${REDACTED_COMMAND_TEXT_VALUE}"`);
  });

  it("redacts an escaped-JSON secret value that contains an escaped quote", () => {
    // A diagnostic can carry a serialized JSON string, so the whole JSON is
    // escaped a second time. The inner value still holds an escaped quote.
    const innerJson = '{"token":"pre\\"MARKERQUOTE_B"}';
    const input = JSON.stringify(innerJson);
    const output = redactDiagnosticText(input);
    expect(output).not.toContain("MARKERQUOTE_B");
    expect(output).toContain(REDACTED_COMMAND_TEXT_VALUE);
  });

  it("redacts an escaped-JSON secret value that contains an escaped backslash", () => {
    const innerJson = '{"password":"pre\\\\MARKERBACKSLASH_B"}';
    const input = JSON.stringify(innerJson);
    const output = redactDiagnosticText(input);
    expect(output).not.toContain("MARKERBACKSLASH_B");
    expect(output).toContain(REDACTED_COMMAND_TEXT_VALUE);
  });
});
