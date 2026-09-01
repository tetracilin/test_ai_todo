import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ArrowDown } from "lucide-react";

const PIN_THRESHOLD_PX = 48;

/** Visibility lifecycle of the scroll-to-latest pill. */
type PillPhase = "hidden" | "in" | "out";

/**
 * True when animations are disabled (prefers-reduced-motion, or environments
 * without matchMedia such as jsdom). In that case the pill's exit animation
 * never fires animationend, so we must unmount immediately.
 */
function motionDisabled(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface TaskMessageScrollerProps {
  children: ReactNode;
  /** Value that changes whenever content that could grow the thread updates. */
  contentKey: unknown;
  className?: string;
  /**
   * Reports the viewport's pinned state (user at bottom within threshold)
   * whenever it flips, plus once on mount. Lets hosts show their own
   * "Jump to latest" affordance exactly when the user is not at bottom.
   */
  onPinnedChange?: (pinned: boolean) => void;
  /**
   * External jump request: incrementing this number triggers the same
   * smooth scroll-to-latest as the pill (TVR-A04).
   */
  jumpSignal?: number;
}

/**
 * Scroll container that owns the redesign's auto-follow vs. hold-position rule.
 *
 * Explicit rule: while the viewport is pinned to the bottom (within a small
 * threshold) new content auto-follows with INSTANT scroll; the moment the user
 * scrolls up we hold their position and surface a scroll-to-latest pill
 * instead of yanking them down.
 *
 * Re-follow is easing-aware: clicking the pill glides down smoothly, and while
 * that glide is in flight (`easingRef`) the scroll handler must not unpin —
 * the smooth scroll fires intermediate scroll events that would otherwise
 * re-show the pill mid-glide (the known stick-to-bottom failure mode). Arrival
 * within the pin threshold re-pins and hides the pill; a wheel/touch during
 * the glide cancels it and treats the user as unpinned. Content-driven follow
 * while pinned stays instant, so no reflow/jump happens during streaming.
 */
export function TaskMessageScroller({ children, contentKey, className, onPinnedChange, jumpSignal }: TaskMessageScrollerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const easingRef = useRef(false);
  const lastReportedPinnedRef = useRef<boolean | null>(null);
  const [pillPhase, setPillPhase] = useState<PillPhase>("hidden");

  // Emit pinned-state changes (and the initial mount state) so hosts can show
  // their own "Jump to latest" affordance exactly when the user is not at
  // bottom (TVR-A04). Deduplicated so handlers never spam the parent.
  const reportPinned = useCallback((pinned: boolean) => {
    if (lastReportedPinnedRef.current === pinned) return;
    lastReportedPinnedRef.current = pinned;
    onPinnedChange?.(pinned);
  }, [onPinnedChange]);

  const showPill = useCallback(() => {
    setPillPhase("in");
  }, []);

  const hidePill = useCallback(() => {
    // Keep rendering through the exit animation; unmount on animationend.
    // Without animations (reduced motion / no matchMedia) unmount immediately.
    setPillPhase((phase) => (phase === "hidden" ? phase : motionDisabled() ? "hidden" : "out"));
  }, []);

  const isPinned = useCallback(() => {
    const el = ref.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_THRESHOLD_PX;
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight; // instant, never smooth
  }, []);

  const handleScroll = useCallback(() => {
    const pinned = isPinned();
    if (easingRef.current) {
      // Smooth re-follow in flight: intermediate scroll events must not
      // unpin/re-show the pill. Only act once we arrive within the threshold.
      if (pinned) {
        easingRef.current = false;
        pinnedRef.current = true;
        hidePill();
        reportPinned(true);
      }
      return;
    }
    pinnedRef.current = pinned;
    reportPinned(pinned);
    if (pinned) hidePill();
    else showPill();
  }, [isPinned, hidePill, showPill, reportPinned]);

  const handleJumpToLatest = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (isPinned()) {
      // Already at (or within threshold of) the bottom: no glide needed.
      pinnedRef.current = true;
      hidePill();
      reportPinned(true);
      return;
    }
    easingRef.current = true;
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      // Environments without scrollTo (older jsdom): fall back to instant.
      el.scrollTop = el.scrollHeight;
      easingRef.current = false;
      pinnedRef.current = true;
      hidePill();
      reportPinned(true);
    }
  }, [isPinned, hidePill, reportPinned]);

  // A user gesture during the smooth glide cancels the re-follow: stop
  // treating scroll events as easing and consider the user unpinned.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cancelEasing = () => {
      if (!easingRef.current) return;
      easingRef.current = false;
      pinnedRef.current = false;
      showPill();
    };
    el.addEventListener("wheel", cancelEasing, { passive: true });
    el.addEventListener("touchstart", cancelEasing, { passive: true });
    return () => {
      el.removeEventListener("wheel", cancelEasing);
      el.removeEventListener("touchstart", cancelEasing);
    };
  }, [showPill]);

  // Follow new content only when already pinned; otherwise hold position.
  useLayoutEffect(() => {
    if (pinnedRef.current) scrollToBottom();
  }, [contentKey, scrollToBottom]);

  // Report the initial pinned state once the viewport has mounted, so hosts
  // that render their own jump control start with the right visibility.
  useLayoutEffect(() => {
    reportPinned(isPinned());
  }, [isPinned, reportPinned]);

  // External "Jump to latest" request (the feed-controls button): each new
  // signal runs the same smooth re-follow as the pill.
  const lastJumpSignalRef = useRef(jumpSignal);
  useEffect(() => {
    if (jumpSignal === undefined || jumpSignal === lastJumpSignalRef.current) return;
    lastJumpSignalRef.current = jumpSignal;
    handleJumpToLatest();
  }, [handleJumpToLatest, jumpSignal]);

  useEffect(() => {
    scrollToBottom();
    // The initial follow pins the viewport; report it so hosts don't show a
    // stale "Jump to latest" right after mount.
    reportPinned(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={ref}
        onScroll={handleScroll}
        // absolute inset-0 (not h-full): the viewport must equal the flex-sized
        // wrapper exactly — percentage heights don't reliably resolve against
        // flex-determined block heights, which let the thread overflow the page.
        className={cn("absolute inset-0 overflow-y-auto", className)}
        data-testid="task-chat-scroller"
      >
        {children}
      </div>
      {pillPhase !== "hidden" ? (
        <button
          type="button"
          aria-label="Scroll to latest"
          onClick={handleJumpToLatest}
          onAnimationEnd={() => {
            if (pillPhase === "out") setPillPhase("hidden");
          }}
          // The tc-scroll-pill-* keyframes carry the translate(-50%) X-centering
          // (fill: both keeps it after the animation) — no -translate-x-1/2 here.
          className={cn(
            "absolute bottom-3 left-1/2 flex size-8 items-center justify-center rounded-full border border-border bg-background shadow-sm hover:bg-muted",
            pillPhase === "out" ? "tc-scroll-pill-out" : "tc-scroll-pill-in",
          )}
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
