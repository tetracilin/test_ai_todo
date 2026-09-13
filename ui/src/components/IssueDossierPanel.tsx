import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { DossierView, DossierViewEntryList, DossierViewSection, IssueDocument } from "@paperclipai/shared";
import { ISSUE_DOSSIER_TITLE, parseDossierView } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { copyTextToClipboard } from "@/lib/clipboard";
import { cn, formatDateTime, relativeTime } from "../lib/utils";
import { MarkdownBody, type MarkdownExternalReferenceMap } from "./MarkdownBody";
import { Check, ChevronDown, ChevronRight, Copy, NotebookText } from "lucide-react";

/**
 * F-002-5 — the dossier's read surface on the card (PC-002, AD-034).
 *
 * The dossier is the record an engineer's agent keeps so the engineer never writes anything
 * up. It is stored as an ordinary `issue_documents` row, so the generic documents section
 * already renders and edits it as markdown; this panel is the *structured* read the PM and the
 * CTO actually need — how much evidence is filed, when the scope moved, and which chat message
 * the card came from — without expanding a document and reading prose.
 *
 * It renders alongside that generic section rather than replacing it: editing a dossier by
 * hand is a legitimate correction path, and taking it away to de-duplicate a heading would
 * remove the only way to fix a bad capture from the UI.
 *
 * Two sections get a structured render (Evidence log, Scope changes) because those are the two
 * the server writes under a closed grammar. The rest stay markdown — see
 * `packages/shared/src/dossier-view.ts` for why a display-only grammar is not worth having.
 */
type IssueDossierPanelProps = {
  document: IssueDocument | null | undefined;
  externalReferences?: MarkdownExternalReferenceMap;
};

/**
 * Renders a dossier timestamp in the viewer's locale, falling back to the stored string
 * VERBATIM rather than to "Invalid Date" — the line grammar shape-checks the timestamp but
 * does not check that it is a real calendar date. The exact stored string is always the
 * `title`/`dateTime`, because the CTO's replanning-latency signal is the timestamp itself,
 * not a localized approximation of it.
 */
function formatDossierTimestamp(at: string): string {
  const parsed = new Date(at);
  return Number.isFinite(parsed.getTime()) ? formatDateTime(parsed) : at;
}

function SectionFrame({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-(length:--text-micro) font-medium uppercase tracking-wide text-muted-foreground">
        {heading}
      </h3>
      {children}
    </section>
  );
}

/**
 * A collapsed count, which is the whole panel until someone expands it.
 *
 * When the section did not fully parse, the count is a LOWER BOUND and says so ("2+"), never a
 * total. The expanded view already refuses to show a list that is one item short; a badge that
 * quietly reported the same short number would undo that, and it would understate exactly the
 * quantity the evidence gate and the wedge metric are both counting. An undercount here reads
 * as "this card has less evidence than it does", which is the one wrong answer that matters.
 */
function CountBadge<T>({
  list,
  singular,
  plural,
}: {
  list: DossierViewEntryList<T>;
  singular: string;
  plural: string;
}) {
  const count = list.entries.length;
  const label = count === 1 ? singular : plural;
  return (
    <Badge
      variant="secondary"
      className="text-(length:--text-nano)"
      title={
        list.complete
          ? undefined
          : "Some lines in this section are not in a recognized format. Expand the dossier to read them all."
      }
    >
      {count}
      {list.complete ? "" : "+"} {label}
    </Badge>
  );
}

function EmptySection() {
  return <p className="text-(length:--text-compact) italic text-muted-foreground">Nothing recorded yet.</p>;
}

function SectionMarkdown({
  body,
  externalReferences,
}: {
  body: string;
  externalReferences?: MarkdownExternalReferenceMap;
}) {
  if (!body.trim()) return <EmptySection />;
  return (
    <MarkdownBody className="text-(length:--text-compact) leading-6" softBreaks externalReferences={externalReferences}>
      {body}
    </MarkdownBody>
  );
}

function EvidenceLog({
  view,
  section,
  externalReferences,
}: {
  view: DossierView;
  section: DossierViewSection;
  externalReferences?: MarkdownExternalReferenceMap;
}) {
  // A section whose grammar did not cover every line falls back to raw markdown WHOLESALE.
  // Rendering the lines that parsed and quietly dropping the rest would turn a hand-edit into
  // a missing evidence item, which is the one thing this card must never do.
  if (!view.evidence.complete) {
    return <SectionMarkdown body={section.body} externalReferences={externalReferences} />;
  }
  if (view.evidence.entries.length === 0) return <EmptySection />;
  return (
    <ul className="space-y-1.5">
      {view.evidence.entries.map((entry, index) => (
        <li key={`${entry.at}-${entry.ref}-${index}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <time
            className="text-(length:--text-micro) tabular-nums text-muted-foreground"
            dateTime={entry.at}
            title={entry.at}
          >
            {formatDossierTimestamp(entry.at)}
          </time>
          <Badge variant="outline" className="border-border font-mono text-(length:--text-nano) uppercase">
            {entry.providerKey}
          </Badge>
          <code className="break-all rounded-sm bg-muted px-1 py-0.5 font-mono text-(length:--text-nano) text-foreground">
            {entry.ref}
          </code>
          {/* Captured content: verbatim Vietnamese, never truncated for layout. */}
          <span className="min-w-0 text-(length:--text-compact) text-foreground">{entry.caption}</span>
        </li>
      ))}
    </ul>
  );
}

function ScopeChanges({
  view,
  section,
  externalReferences,
}: {
  view: DossierView;
  section: DossierViewSection;
  externalReferences?: MarkdownExternalReferenceMap;
}) {
  if (!view.scopeChanges.complete) {
    return <SectionMarkdown body={section.body} externalReferences={externalReferences} />;
  }
  if (view.scopeChanges.entries.length === 0) return <EmptySection />;
  return (
    <ul className="space-y-1.5">
      {view.scopeChanges.entries.map((entry, index) => (
        <li key={`${entry.at}-${index}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <time
            className="text-(length:--text-micro) tabular-nums text-muted-foreground"
            dateTime={entry.at}
            title={entry.at}
          >
            {formatDossierTimestamp(entry.at)}
          </time>
          <span className="min-w-0 text-(length:--text-compact) text-foreground">{entry.note}</span>
        </li>
      ))}
    </ul>
  );
}

export function IssueDossierPanel({ document, externalReferences }: IssueDossierPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const copyBody = useCallback(async () => {
    if (!document) return;
    try {
      await copyTextToClipboard(document.body);
    } catch {
      return;
    }
    setCopied(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
  }, [document]);

  if (!document) return null;

  const view = parseDossierView(document.body);
  const heading = view?.title?.trim() || document.title?.trim() || ISSUE_DOSSIER_TITLE;

  return (
    <div id="issue-dossier-panel" data-testid="issue-dossier-panel" className="mb-3 rounded-lg border border-border bg-accent/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          onClick={() => setExpanded((current) => !current)}
          aria-label={expanded ? "Collapse dossier" : "Expand dossier"}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <NotebookText className="h-4 w-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">{heading}</span>
            <Badge variant="outline" className="border-border font-mono text-(length:--text-nano) uppercase text-muted-foreground">
              dossier
            </Badge>
            {/* Collapsed, these two counts ARE the panel: they are what the evidence gate and the
                CTO's replanning-latency question are both asking about. */}
            {view ? (
              <>
                <CountBadge list={view.evidence} singular="evidence" plural="evidence" />
                <CountBadge list={view.scopeChanges} singular="scope change" plural="scope changes" />
              </>
            ) : null}
          </div>
          <div className="text-(length:--text-micro) text-muted-foreground">
            Updated {relativeTime(document.updatedAt)}
            {document.latestRevisionNumber > 0 ? ` · revision ${document.latestRevisionNumber}` : ""}
            {view?.chatCorrelation
              ? ` · from ${view.chatCorrelation.originKind} message ${view.chatCorrelation.chatOriginId}`
              : ""}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={copyBody} className="shrink-0">
          {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {expanded ? (
        <div className="mt-3 space-y-3 rounded-md border border-border bg-background/80 p-3">
          {view ? (
            <>
              {view.preamble ? (
                <SectionMarkdown body={view.preamble} externalReferences={externalReferences} />
              ) : null}
              {view.sections.map((section) => (
                <SectionFrame key={section.heading} heading={section.heading}>
                  {section.heading === "Evidence log" ? (
                    <EvidenceLog view={view} section={section} externalReferences={externalReferences} />
                  ) : section.heading === "Scope changes" ? (
                    <ScopeChanges view={view} section={section} externalReferences={externalReferences} />
                  ) : (
                    <SectionMarkdown body={section.body} externalReferences={externalReferences} />
                  )}
                </SectionFrame>
              ))}
            </>
          ) : (
            /* Not a parseable dossier — a hand-edit, or a writer version this UI predates. Show
               the document as it is stored rather than an error or an empty frame. */
            <MarkdownBody
              className="text-(length:--text-compact) leading-6"
              softBreaks={false}
              externalReferences={externalReferences}
            >
              {document.body}
            </MarkdownBody>
          )}
        </div>
      ) : null}
    </div>
  );
}
