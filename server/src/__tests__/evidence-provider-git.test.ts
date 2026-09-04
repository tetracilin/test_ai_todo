import { describe, expect, it, vi } from "vitest";
import {
  matchesIssueBranch,
  parseCommitUrl,
  parseGitRemote,
  verifyGitCommitEvidence,
} from "../services/evidence-provider-git.js";

describe("parseGitRemote", () => {
  it("parses an https remote", () => {
    expect(parseGitRemote("https://github.com/tetracilin/test_ai_todo.git")).toEqual({
      host: "github.com",
      path: "tetracilin/test_ai_todo",
    });
  });

  it("parses an https remote with no .git suffix", () => {
    expect(parseGitRemote("https://github.com/tetracilin/test_ai_todo")).toEqual({
      host: "github.com",
      path: "tetracilin/test_ai_todo",
    });
  });

  it("parses a scp-like remote", () => {
    expect(parseGitRemote("git@github.com:tetracilin/test_ai_todo.git")).toEqual({
      host: "github.com",
      path: "tetracilin/test_ai_todo",
    });
  });

  it("lowercases the host", () => {
    expect(parseGitRemote("https://GitHub.com/org/repo")).toMatchObject({ host: "github.com" });
  });

  it("returns null for an unparseable remote", () => {
    expect(parseGitRemote("not a url")).toBeNull();
    expect(parseGitRemote("")).toBeNull();
  });
});

describe("parseCommitUrl", () => {
  it("parses a GitHub-style commit URL", () => {
    expect(parseCommitUrl("https://github.com/org/repo/commit/abc1234def5678")).toEqual({
      host: "github.com",
      repoPath: "org/repo",
      hash: "abc1234def5678",
    });
  });

  it("parses a GitLab-style commit URL", () => {
    expect(parseCommitUrl("https://gitlab.com/org/repo/-/commit/abc1234")).toEqual({
      host: "gitlab.com",
      repoPath: "org/repo",
      hash: "abc1234",
    });
  });

  it("lowercases the hash", () => {
    expect(parseCommitUrl("https://github.com/org/repo/commit/ABC1234")).toMatchObject({ hash: "abc1234" });
  });

  it("does not accept a lookalike host as a substring/prefix match", () => {
    // review finding 3.1: this must not be confused with github.com by any
    // matcher built on prefix/substring comparison.
    const parsed = parseCommitUrl("https://github.com.attacker.example/org/repo/commit/abc1234");
    expect(parsed?.host).toBe("github.com.attacker.example");
    expect(parsed?.host).not.toBe("github.com");
  });

  it("returns null for a URL with no commit path", () => {
    expect(parseCommitUrl("https://github.com/org/repo")).toBeNull();
  });

  it("returns null for an unparseable URL", () => {
    expect(parseCommitUrl("not a url")).toBeNull();
  });
});

describe("matchesIssueBranch", () => {
  it("matches the bare identifier with a slug suffix", () => {
    expect(matchesIssueBranch("PC-007-slug", "PC-007")).toBe(true);
  });

  it("matches the identifier under a feature/ prefix", () => {
    expect(matchesIssueBranch("feature/PC-007-slug", "PC-007")).toBe(true);
  });

  it("matches the bare identifier with no suffix", () => {
    expect(matchesIssueBranch("PC-007", "PC-007")).toBe(true);
  });

  it("does not match a different identifier", () => {
    expect(matchesIssueBranch("PC-008-slug", "PC-007")).toBe(false);
  });

  it("does not match a identifier that is only a prefix of the branch segment", () => {
    expect(matchesIssueBranch("PC-0071-slug", "PC-007")).toBe(false);
  });

  it("does not match with an unrelated prefix", () => {
    expect(matchesIssueBranch("chore/PC-007-slug", "PC-007")).toBe(false);
  });
});

describe("verifyGitCommitEvidence", () => {
  const workspace = { repoUrl: "https://github.com/org/repo.git", cwd: "/workspaces/repo" };

  function execFileAsyncThatResolves() {
    return vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
  }

  function execFileAsyncThatRejects() {
    return vi.fn().mockRejectedValue(new Error("fatal: Not a valid object name"));
  }

  it("rejects when the issue has no configured workspace", async () => {
    await expect(
      verifyGitCommitEvidence({
        descriptor: { providerKey: "git", objectType: "commit", externalId: "abc1234" },
        workspace: null,
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("rejects when the workspace has no repoUrl or cwd", async () => {
    await expect(
      verifyGitCommitEvidence({
        descriptor: { providerKey: "git", objectType: "commit", externalId: "abc1234" },
        workspace: { repoUrl: null, cwd: "/workspaces/repo" },
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("rejects a commit URL on a lookalike host", async () => {
    const execFileAsync = execFileAsyncThatResolves();
    await expect(
      verifyGitCommitEvidence({
        descriptor: {
          providerKey: "git",
          objectType: "commit",
          externalId: "abc1234",
          url: "https://github.com.attacker.example/org/repo/commit/abc1234def",
        },
        workspace,
        execFileAsync,
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it("rejects a commit URL on the right host but a different repo path", async () => {
    await expect(
      verifyGitCommitEvidence({
        descriptor: {
          providerKey: "git",
          objectType: "commit",
          externalId: "abc1234",
          url: "https://github.com/org/other-repo/commit/abc1234def",
        },
        workspace,
        execFileAsync: execFileAsyncThatResolves(),
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("rejects a hash that does not resolve in the local object database", async () => {
    await expect(
      verifyGitCommitEvidence({
        descriptor: { providerKey: "git", objectType: "commit", externalId: "abc1234" },
        workspace,
        execFileAsync: execFileAsyncThatRejects(),
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("rejects a malformed hash before ever shelling out", async () => {
    const execFileAsync = execFileAsyncThatResolves();
    await expect(
      verifyGitCommitEvidence({
        descriptor: { providerKey: "git", objectType: "commit", externalId: "not-a-hash" },
        workspace,
        execFileAsync,
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it("links a commit URL that matches the workspace's remote and resolves locally", async () => {
    const execFileAsync = execFileAsyncThatResolves();
    const target = await verifyGitCommitEvidence({
      descriptor: {
        providerKey: "git",
        objectType: "commit",
        externalId: "ignored",
        url: "https://github.com/org/repo/commit/abc1234def5678",
        displayTitle: "The fix",
      },
      workspace,
      execFileAsync,
    });

    expect(target).toMatchObject({
      providerKey: "git",
      objectType: "commit",
      externalId: "abc1234def5678",
      url: "https://github.com/org/repo/commit/abc1234def5678",
      displayTitle: "The fix",
      data: { verifiedHost: "github.com", verifiedRepoPath: "org/repo" },
    });
    expect(execFileAsync).toHaveBeenCalledWith(
      "git",
      ["cat-file", "-e", "abc1234def5678^{commit}"],
      { cwd: "/workspaces/repo" },
    );
  });

  it("links a bare hash straight against the local object database, with no URL required", async () => {
    const execFileAsync = execFileAsyncThatResolves();
    const target = await verifyGitCommitEvidence({
      descriptor: { providerKey: "git", objectType: "commit", externalId: "ABC1234" },
      workspace,
      execFileAsync,
    });

    expect(target).toMatchObject({ externalId: "abc1234", url: null });
    expect(execFileAsync).toHaveBeenCalledWith(
      "git",
      ["cat-file", "-e", "abc1234^{commit}"],
      { cwd: "/workspaces/repo" },
    );
  });

  it("matches an scp-like configured remote against an https commit URL", async () => {
    const target = await verifyGitCommitEvidence({
      descriptor: {
        providerKey: "git",
        objectType: "commit",
        externalId: "ignored",
        url: "https://github.com/org/repo/commit/abc1234def",
      },
      workspace: { repoUrl: "git@github.com:org/repo.git", cwd: "/workspaces/repo" },
      execFileAsync: execFileAsyncThatResolves(),
    });
    expect(target).toMatchObject({ externalId: "abc1234def" });
  });
});
