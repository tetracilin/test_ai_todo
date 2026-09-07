import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { unprocessable } from "../errors.js";
import type { EvidenceLinkTarget } from "./issue-evidence-links.js";

const execFileAsyncDefault = promisify(execFile);
export type ExecFileAsync = (
  file: string,
  args: string[],
  options: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>;

const HASH_RE = /^[0-9a-f]{7,40}$/i;
const COMMIT_PATH_RE = /^(.*?)\/(?:-\/)?commit\/([0-9a-fA-F]{7,40})$/;

export interface ParsedGitRemote {
  host: string;
  path: string;
}

/**
 * Parses a git remote into `{host, path}`, supporting both `https://` and
 * scp-like (`git@host:org/repo.git`) forms. Normalized so a trailing `.git`,
 * leading/trailing slashes, and host case never cause a false mismatch.
 */
export function parseGitRemote(remote: string): ParsedGitRemote | null {
  const trimmed = remote.trim();
  if (!trimmed) return null;
  const scpMatch = /^[\w.-]+@([\w.-]+):(.+)$/.exec(trimmed);
  if (scpMatch) {
    const [, host, rawPath] = scpMatch;
    return normalizeHostPath(host!, rawPath!);
  }
  try {
    const url = new URL(trimmed);
    return normalizeHostPath(url.hostname, url.pathname);
  } catch {
    return null;
  }
}

function normalizeHostPath(host: string, rawPath: string): ParsedGitRemote {
  const path = rawPath
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  return { host: host.toLowerCase(), path };
}

export interface ParsedCommitUrl {
  host: string;
  repoPath: string;
  hash: string;
}

/**
 * Extracts `{host, repoPath, hash}` from a GitHub- or GitLab-style commit URL
 * (`.../org/repo/commit/<hash>` or `.../org/repo/-/commit/<hash>`). Exact
 * path parsing, never a prefix/substring match -- a lookalike host
 * (`github.com/org/repo.attacker.example`) must never pass (review 3.1).
 */
export function parseCommitUrl(url: string): ParsedCommitUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const path = parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  const match = COMMIT_PATH_RE.exec(path);
  if (!match) return null;
  const [, repoPath, hash] = match;
  return {
    host: parsed.hostname.toLowerCase(),
    repoPath: repoPath!.replace(/\.git$/i, ""),
    hash: hash!.toLowerCase(),
  };
}

/**
 * PC-007 AC2's branch matcher: does `branchName` belong to `issueIdentifier`
 * ("PC-007-slug" and "feature/PC-007-slug" both match "PC-007")? Pure and
 * standalone -- wiring an automatic auto-link-on-push trigger to this is a
 * separate, later unit; this only answers the matching question so that
 * trigger has something correct to call.
 */
export function matchesIssueBranch(branchName: string, issueIdentifier: string): boolean {
  const identifier = issueIdentifier.trim();
  if (!identifier) return false;
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^(feature/)?${escaped}(-.*)?$`, "i");
  return re.test(branchName.trim());
}

export interface GitEvidenceDescriptor {
  providerKey: string;
  objectType: string;
  externalId: string;
  displayTitle?: string | null;
  url?: string | null;
}

export interface GitWorkspaceContext {
  repoUrl: string | null;
  cwd: string | null;
}

export interface VerifyGitCommitEvidenceInput {
  descriptor: GitEvidenceDescriptor;
  /** The issue's `project_workspaces` row, or null when it has none configured. */
  workspace: GitWorkspaceContext | null;
  execFileAsync?: ExecFileAsync;
}

async function commitExistsLocally(cwd: string, hash: string, execFileAsync: ExecFileAsync): Promise<boolean> {
  try {
    await execFileAsync("git", ["cat-file", "-e", `${hash}^{commit}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * PC-007 AC2: a commit URL or bare hash is verified against the issue's own
 * configured repository before it is ever linked as evidence -- optimistic
 * linking is exactly the hole this unit closes (review 3.1/3.2).
 *
 * Verification checks TWO things, both required:
 *   1. If a URL was submitted, its host+repo-path match the workspace's
 *      configured `repoUrl` EXACTLY (never a prefix/substring).
 *   2. The commit hash resolves in the workspace's LOCAL git object database
 *      at `cwd` (`git cat-file -e <hash>^{commit}`, argv array -- never a
 *      shell string). This checks what's already fetched locally; it does
 *      not fetch/pull first, so a very recently pushed commit can transiently
 *      fail verification until the workspace next syncs.
 *
 * A bare hash (no url) skips step 1 and resolves straight against `cwd` --
 * it is never accepted as an unverified string either way.
 */
export async function verifyGitCommitEvidence(input: VerifyGitCommitEvidenceInput): Promise<EvidenceLinkTarget> {
  const { descriptor, workspace } = input;
  const execFileAsync = input.execFileAsync ?? (execFileAsyncDefault as unknown as ExecFileAsync);

  if (!workspace || !workspace.repoUrl || !workspace.cwd) {
    throw unprocessable("No repository is configured for this issue's workspace");
  }
  const remote = parseGitRemote(workspace.repoUrl);
  if (!remote) {
    throw unprocessable("The issue's configured repository URL could not be parsed");
  }

  let hash: string;
  if (descriptor.url) {
    const parsedCommit = parseCommitUrl(descriptor.url);
    if (!parsedCommit) {
      throw unprocessable("Commit URL is not a recognized host/commit link");
    }
    if (parsedCommit.host !== remote.host || parsedCommit.repoPath !== remote.path) {
      throw unprocessable("Commit URL does not match this issue's configured repository");
    }
    hash = parsedCommit.hash;
  } else {
    hash = descriptor.externalId.trim().toLowerCase();
  }

  if (!HASH_RE.test(hash)) {
    throw unprocessable("Commit hash is not a valid git object id");
  }
  const exists = await commitExistsLocally(workspace.cwd, hash, execFileAsync);
  if (!exists) {
    throw unprocessable("Commit was not found in the workspace's local repository");
  }

  return {
    providerKey: descriptor.providerKey,
    objectType: descriptor.objectType,
    externalId: hash,
    displayTitle: descriptor.displayTitle ?? `commit ${hash.slice(0, 12)}`,
    url: descriptor.url ?? null,
    data: {
      verifiedHost: remote.host,
      verifiedRepoPath: remote.path,
      verifiedAt: new Date().toISOString(),
    },
  };
}
