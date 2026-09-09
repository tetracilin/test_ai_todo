import { useMemo, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  GitCommit,
  HardDrive,
  Link2,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ApiError } from "@/api/client";
import { issuesApi, type IssueEvidenceLink, type IssueEvidenceSource } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { companiesApi } from "@/api/companies";
import { relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** The three providers the evidence routes verify (evidence-provider-*.ts). */
type EvidenceProviderKey = "git" | "nas" | "minio";

const PROVIDERS: Record<EvidenceProviderKey, { label: string; objectType: string; icon: LucideIcon }> = {
  git: { label: "Git commit", objectType: "commit", icon: GitCommit },
  nas: { label: "NAS path", objectType: "path", icon: HardDrive },
  minio: { label: "Uploaded file", objectType: "file", icon: Upload },
};

const SOURCE_LABELS: Record<IssueEvidenceSource, string> = {
  manual: "Manual",
  bot: "Bot",
  system: "System",
};

function providerLabel(providerKey: string) {
  return PROVIDERS[providerKey as EvidenceProviderKey]?.label ?? providerKey;
}

function providerIcon(providerKey: string): LucideIcon {
  return PROVIDERS[providerKey as EvidenceProviderKey]?.icon ?? Link2;
}

function sourceLabel(source: string) {
  return SOURCE_LABELS[source as IssueEvidenceSource] ?? source;
}

/**
 * The upload route is the only path that mints a stored (minio) evidence
 * object, and it replies 501 when the instance has no external storage. That
 * is a configuration fact, not a failure of the request, so it gets its own
 * message rather than the generic error text.
 */
function evidenceErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.status === 501) {
    return "External evidence storage is not configured on this server. Link a git commit or a NAS path instead, or ask an admin to configure storage.";
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

/**
 * A git commit URL's hash is its last path segment. The descriptor schema
 * always requires `externalId`, but when a `url` is sent the server verifies
 * and stores the hash parsed out of the URL (evidence-provider-git.ts), so the
 * value here only has to be a faithful non-empty stand-in.
 */
function commitExternalIdFromUrl(url: string) {
  const withoutQuery = url.split(/[?#]/)[0] ?? url;
  const segments = withoutQuery.replace(/\/+$/, "").split("/");
  return segments[segments.length - 1] || url;
}

function looksLikeUrl(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

type AddEvidenceDialogProps = {
  companyId: string;
  issueId: string;
  onDone: () => void;
};

function AddEvidenceDialog({ companyId, issueId, onDone }: AddEvidenceDialogProps) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<EvidenceProviderKey>("git");
  const [commit, setCommit] = useState("");
  const [nasPath, setNasPath] = useState("");
  const [displayTitle, setDisplayTitle] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const reset = () => {
    setCommit("");
    setNasPath("");
    setDisplayTitle("");
    setSelectedFile(null);
  };
  const close = () => {
    setOpen(false);
    reset();
  };

  const linkDescriptor = useMutation({
    mutationFn: () => {
      const title = displayTitle.trim();
      if (provider === "git") {
        const value = commit.trim();
        if (!value) throw new Error("Enter a commit hash or a commit URL.");
        return issuesApi.linkEvidence(issueId, {
          providerKey: "git",
          objectType: PROVIDERS.git.objectType,
          externalId: looksLikeUrl(value) ? commitExternalIdFromUrl(value) : value,
          ...(looksLikeUrl(value) ? { url: value } : {}),
          ...(title ? { displayTitle: title } : {}),
        });
      }
      const path = nasPath.trim();
      if (!path) throw new Error("Enter the absolute NAS path.");
      return issuesApi.linkEvidence(issueId, {
        providerKey: "nas",
        objectType: PROVIDERS.nas.objectType,
        externalId: path,
        ...(title ? { displayTitle: title } : {}),
      });
    },
    onSuccess: () => {
      onDone();
      close();
    },
  });
  const uploadEvidence = useMutation({
    mutationFn: () => {
      if (!selectedFile) throw new Error("Choose a file to upload as evidence.");
      return issuesApi.uploadEvidenceFile(companyId, issueId, selectedFile);
    },
    onSuccess: () => {
      onDone();
      close();
    },
  });

  const error = linkDescriptor.error ?? uploadEvidence.error;
  const pending = linkDescriptor.isPending || uploadEvidence.isPending;
  const submitDisabled =
    pending ||
    (provider === "git" ? !commit.trim() : provider === "nas" ? !nasPath.trim() : !selectedFile);

  const submit = () => {
    if (provider === "minio") uploadEvidence.mutate();
    else linkDescriptor.mutate();
  };
  const chooseProvider = (next: EvidenceProviderKey) => {
    setProvider(next);
    linkDescriptor.reset();
    uploadEvidence.reset();
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Link2 className="mr-1.5 h-3.5 w-3.5" />
        Link evidence
      </Button>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent className="max-h-(--sz-calc-18) overflow-y-auto sm:max-w-(--sz-560px)">
          <DialogHeader>
            <DialogTitle>Link evidence</DialogTitle>
            <DialogDescription>
              Evidence is what the done-gate counts. A commit is verified against this task&apos;s repository, a NAS path is recorded as a path reference only, and an uploaded file is stored in external storage.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(PROVIDERS) as EvidenceProviderKey[]).map((key) => (
                <Button
                  key={key}
                  type="button"
                  variant={provider === key ? "default" : "outline"}
                  onClick={() => chooseProvider(key)}
                >
                  {PROVIDERS[key].label}
                </Button>
              ))}
            </div>
            {provider === "git" ? (
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="evidence-commit">Commit hash or commit URL</label>
                <Input
                  id="evidence-commit"
                  value={commit}
                  onChange={(event) => setCommit(event.target.value)}
                  placeholder="a1b2c3d or https://github.com/org/repo/commit/a1b2c3d"
                />
                <p className="text-(length:--text-micro) text-muted-foreground">
                  The commit must exist in this task&apos;s configured repository — an unverifiable commit is refused rather than linked.
                </p>
              </div>
            ) : provider === "nas" ? (
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="evidence-nas-path">Absolute NAS path</label>
                <Input
                  id="evidence-nas-path"
                  value={nasPath}
                  onChange={(event) => setNasPath(event.target.value)}
                  placeholder="//nas/evidence/2026/report.pdf"
                />
                <p className="text-(length:--text-micro) text-muted-foreground">
                  Path reference only — no file content leaves the NAS.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Input
                  type="file"
                  aria-label="Evidence file"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setSelectedFile(event.target.files?.[0] ?? null)}
                />
                <p className="text-(length:--text-micro) text-muted-foreground">
                  Uploaded to external evidence storage. Unavailable when this server has no external storage configured.
                </p>
              </div>
            )}
            {provider === "minio" ? null : (
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="evidence-display-title">Title</label>
                <Input
                  id="evidence-display-title"
                  value={displayTitle}
                  onChange={(event) => setDisplayTitle(event.target.value)}
                  placeholder="Optional label shown on the evidence row"
                />
              </div>
            )}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {evidenceErrorMessage(error, "Could not link evidence.")}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={pending}>Cancel</Button>
            <Button disabled={submitDisabled} onClick={submit}>
              {pending ? "Linking…" : "Link evidence"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EvidenceLinkRow({
  link,
  issueId,
  onDone,
}: {
  link: IssueEvidenceLink;
  issueId: string;
  onDone: () => void;
}) {
  const unlink = useMutation({
    mutationFn: () => issuesApi.unlinkEvidence(issueId, link.id),
    onSuccess: () => onDone(),
  });
  const Icon = providerIcon(link.providerKey);
  const title = link.displayTitle?.trim() || link.externalId;

  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card/50 p-3">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-(length:--text-micro) text-muted-foreground">
          {providerLabel(link.providerKey)} · {sourceLabel(link.source)} · {relativeTime(link.createdAt)}
        </p>
        {unlink.error ? (
          <p className="text-(length:--text-micro) text-destructive" role="alert">
            {evidenceErrorMessage(unlink.error, "Could not remove this evidence link.")}
          </p>
        ) : null}
      </div>
      {link.sanitizedCanonicalUrl ? (
        <a
          href={link.sanitizedCanonicalUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${title}`}
          title="Open"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        aria-label={`Remove evidence ${title}`}
        disabled={unlink.isPending}
        onClick={() => unlink.mutate()}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/**
 * Evidence links (PC-007) as a browser surface.
 *
 * The done-gate (`companies.evidence_gate_enabled`) counts issue attachments
 * PLUS evidence links (`countEvidenceForIssue`), so the count shown here sums
 * both — a card with an attachment and no link already satisfies the gate, and
 * showing only the link count would read as blocked when it is not.
 */
export function IssueEvidenceLinkManager({ companyId, issueId }: { companyId: string; issueId: string }) {
  const queryClient = useQueryClient();
  // evidence_gate_enabled defaults to FALSE (packages/db/src/schema/companies.ts:35) and is
  // only enforced when the company opts in (server/src/services/issues.ts:7940). Read the real
  // flag rather than telling every user their card is blocked when nothing blocks it.
  //
  // Queried, not taken from CompanyContext: this is a leaf component and useCompany() throws
  // outside a CompanyProvider, which would make it unmountable in isolation. An unresolved
  // query yields false, i.e. the neutral copy -- the safe direction to be wrong in.
  const { data: company } = useQuery({
    queryKey: queryKeys.companies.detail(companyId),
    queryFn: () => companiesApi.get(companyId),
    staleTime: 5 * 60 * 1000,
  });
  const gateEnabled = company?.evidenceGateEnabled ?? false;
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.issues.evidenceLinks(issueId),
    queryFn: () => issuesApi.listEvidenceLinks(issueId),
  });
  const { data: attachments } = useQuery({
    queryKey: queryKeys.issues.attachments(issueId),
    queryFn: () => issuesApi.listAttachments(issueId),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.issues.evidenceLinks(issueId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.issues.attachments(issueId) });
  };
  const links = useMemo(() => data ?? [], [data]);
  const gateCount = links.length + (attachments?.length ?? 0);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Evidence</h3>
          <p className="text-(length:--text-micro) text-muted-foreground">
            Commits, NAS paths, and uploaded files filed against this task. Attachments count as evidence too.
          </p>
        </div>
        <AddEvidenceDialog companyId={companyId} issueId={issueId} onDone={refresh} />
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading evidence…</p> : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {evidenceErrorMessage(error, "Could not load evidence links.")}
        </p>
      ) : null}
      {!isLoading && !error ? (
        <p className="flex items-center gap-1.5 text-(length:--text-micro) text-muted-foreground">
          <Paperclip className="h-3 w-3 shrink-0" />
          {gateCount === 0
            ? gateEnabled
              ? "No evidence yet — the done-gate blocks this task while the count is 0."
              : "No evidence yet."
            : `${gateCount} evidence ${gateCount === 1 ? "item" : "items"}${gateEnabled ? " counted by the done-gate" : ""} (${links.length} linked, ${attachments?.length ?? 0} attached).`}
        </p>
      ) : null}
      {!isLoading && !error && links.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          No evidence links. Use Link evidence to file a commit, a NAS path, or an uploaded file.
        </p>
      ) : null}
      <div className="space-y-2">
        {links.map((link) => (
          <EvidenceLinkRow key={link.id} link={link} issueId={issueId} onDone={refresh} />
        ))}
      </div>
    </section>
  );
}
