import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCmdShimInvocation, needsCmdShim } from "./spawn-safe.mjs";

describe("spawn-safe", () => {
  it("only routes pnpm-style shims through cmd.exe, and only on win32", () => {
    assert.equal(needsCmdShim("pnpm", "win32"), true);
    assert.equal(needsCmdShim("git", "win32"), false);
    assert.equal(needsCmdShim("pnpm", "linux"), false);
  });

  it("quotes every argument so metacharacters stay literal", () => {
    const { args } = buildCmdShimInvocation("pnpm", ["exec", "feature/a&calc", "a b|c"]);
    assert.deepEqual(args.slice(0, 3), ["/d", "/s", "/c"]);
    assert.equal(args[3], '""pnpm" "exec" "feature/a&calc" "a b|c""');
  });

  for (const bad of ['a"b', "50%", "a\nb"]) {
    it(`rejects an argument that could escape the quotes: ${JSON.stringify(bad)}`, () => {
      assert.throws(() => buildCmdShimInvocation("pnpm", [bad]), /refusing/);
    });
  }
});
