/**
 * WP-0 canonical Vietnamese phrase table (backlog "Epic 0 — Recorder platform",
 * WP-0 operational AC10).
 *
 * This module is the single checked-in source of truth for every Vietnamese
 * string the four-verb chat bot says to, or accepts from, a field engineer. It
 * exists so that a rejection can never name a phrase the bot does not answer
 * to: the agent system prompt and the error-message templates both read this
 * table instead of hard-coding copy in two places.
 *
 * Two consumers, one table:
 * - the agent system prompt, via `renderWp0AgentPromptSection()` (English
 *   framing, Vietnamese phrases quoted verbatim — the language boundary in
 *   backlog WP-0: prompts and code are English, engineer-facing copy is
 *   Vietnamese);
 * - the error-message templates in `WP0_MESSAGE_TEMPLATES`, rendered with
 *   `renderWp0Message()`, whose `{{phrase.<verb>}}` placeholders resolve out of
 *   `WP0_VERB_PHRASES`.
 *
 * The table also doubles as the PC-003 Vietnamese engineer quickstart appendix
 * (`renderWp0HelpMessage()` is exactly what the help verb returns).
 *
 * Retry ownership (op AC9): a message sent because an attempt failed states
 * *who* retries — the system (`WP0_RETRY_NOTICES.system`) or the engineer
 * (`WP0_RETRY_NOTICES.engineer`), never both, never neither. Messages that are
 * not a failed attempt carry `retryOwner: null` and neither clause.
 *
 * Inbound resolution order (the consumer contract): an inbound engineer message
 * is classified in TWO steps, not one, and the contract is `classifyWp0Inbound()`
 * — an exported function, not prose, so a consumer cannot get the ordering or
 * the context requirement wrong by copying it out of a test.
 *   1. `resolveWp0CardReference()` — a reply that is just a card number
 *      ("T3-142", "142", "#142") is a CORRECTION turn against the capture the
 *      bot last confirmed, not a verb. Several templates ask for exactly this
 *      (`WP0_CARD_REPLY_INSTRUCTION`), so a consumer that skips this step will
 *      answer a correction with `unknown_phrase` and the mis-file is never
 *      fixed. **Reply-scoped:** it is a correction only when there IS a capture
 *      to correct, which is why `classifyWp0Inbound()` takes the pending
 *      capture as a required argument — a standalone "142" from an engineer
 *      with nothing pending is a meter reading, not a card number, and must
 *      never re-file evidence.
 *   2. `resolveWp0Verb()` — verb matching, and ONLY verb matching. It is a
 *      lookup in `wp0PhraseIndex()`; it knows nothing about card numbers, NAS
 *      paths, or free-form capture text.
 * Only when both return `null` is the message unrecognized (`unknown_phrase`).
 *
 * What the table deliberately does NOT answer to: cancelling, deleting, or
 * reassigning a card. No WP-0 verb does any of those, so no template may tell
 * an engineer to ask the bot for one — that is the op AC10 failure mode
 * ("a rejection can never name a phrase the bot doesn't answer to"), and
 * `wp0-phrases.test.ts` enforces it over every template body, not just over
 * `{{phrase.*}}` placeholders.
 *
 * Scope: the Discord DM pilot (gate decision 2026-09-02, Discord-only). Nothing
 * here is channel-specific; a later transport binds to the same table.
 */

/** The verbs the bot answers to. Ordering is the help/quickstart ordering. */
export const WP0_VERB_IDS = ["capture", "brief", "evidence", "digest", "help"] as const;

export type Wp0VerbId = (typeof WP0_VERB_IDS)[number];

export interface Wp0VerbPhrase {
  /** The phrase the bot advertises. Every rejection names this form. */
  readonly canonical: string;
  /**
   * Other spellings accepted for the same verb. Each verb carries at least one
   * ASCII-only alias — field engineers type without diacritics on a phone.
   */
  readonly aliases: readonly string[];
  /** English one-liner for the agent system prompt. Never shown to engineers. */
  readonly gloss: string;
  /** Vietnamese one-liner returned by the help verb. */
  readonly help: string;
  /** Who normally uses this verb. */
  readonly audience: "engineer" | "pm";
}

export const WP0_VERB_PHRASES: Record<Wp0VerbId, Wp0VerbPhrase> = {
  capture: {
    canonical: "ghi nhận",
    aliases: ["ghi nhan", "ghi", "ghi lại", "ghi lai", "tạo thẻ", "tao the", "việc mới", "viec moi", "capture"],
    gloss: "turn a forwarded job order or a photo into a card",
    help: "gửi ảnh hoặc chuyển tiếp tin nhắn việc mới, mình tạo thẻ và ghi lại giúp bạn.",
    audience: "engineer",
  },
  brief: {
    canonical: "tóm tắt",
    aliases: ["tom tat", "brief", "tình hình", "tinh hinh", "việc của mình", "viec cua minh", "đang làm gì", "dang lam gi"],
    gloss: "re-brief: current card, open evidence gaps, next task",
    help: "mình nhắc bạn đang ở thẻ nào, còn thiếu bằng chứng gì, việc tiếp theo là gì.",
    audience: "engineer",
  },
  evidence: {
    canonical: "nộp bằng chứng",
    aliases: [
      "nop bang chung",
      "bằng chứng",
      "bang chung",
      "nộp",
      "nop",
      "đính kèm",
      "dinh kem",
      "gửi bằng chứng",
      "gui bang chung",
      "evidence",
    ],
    gloss: "file a photo, file, or link as evidence on a card",
    help: "gắn ảnh, tệp hoặc link vào thẻ làm bằng chứng để đóng được thẻ.",
    audience: "engineer",
  },
  digest: {
    canonical: "báo cáo ngày",
    aliases: ["bao cao ngay", "báo cáo", "bao cao", "tổng hợp", "tong hop", "digest"],
    gloss: "daily PM/CTO summary: evidence filed, cards blocked on missing evidence",
    help: "bản tổng hợp trong ngày cho PM/CTO: ai nộp bằng chứng gì, thẻ nào đang kẹt.",
    audience: "pm",
  },
  help: {
    canonical: "trợ giúp",
    aliases: ["tro giup", "giúp", "giup", "hướng dẫn", "huong dan", "lệnh", "lenh", "help"],
    gloss: "return this phrase table",
    help: "gửi lại đúng danh sách từ khoá này.",
    audience: "engineer",
  },
};

/** Who is expected to act next after a failure message (op AC9). */
export const WP0_RETRY_OWNERS = ["system", "engineer"] as const;

export type Wp0RetryOwner = (typeof WP0_RETRY_OWNERS)[number];

/**
 * The exact Vietnamese clauses that state who retries. Op AC9 names both
 * strings verbatim; a failure message that omits them is ambiguous to the
 * engineer, so `WP0_MESSAGE_TEMPLATES` entries with a `retryOwner` must embed
 * the matching one and must not embed the other.
 */
export const WP0_RETRY_NOTICES: Record<Wp0RetryOwner, string> = {
  system: "mình sẽ thử lại trong 5 phút",
  engineer: "gửi lại giúp mình",
};

/**
 * The one instruction a template may use to ask for the correction turn, and
 * the example it shows.
 *
 * The copy asks for the number **alone** because that is exactly what
 * `resolveWp0CardReference()` resolves: it anchors the whole normalized message
 * (`WP0_CARD_REFERENCE_PATTERN`), so "thẻ T3-142", "T3-142 nhé" and "đúng ra là
 * 142" are NOT card references and fall through to `unknown_phrase`. Copy that
 * invited a number *alongside* other words ("kèm số thẻ") advertised a reply the
 * resolver rejects — the op AC10 failure mode, one paraphrase away. Copy and
 * matcher are pinned to each other in `wp0-phrases.test.ts`; widen the pattern
 * first if you ever want to widen this sentence.
 */
export const WP0_CARD_REPLY_INSTRUCTION = "trả lời tin này, chỉ ghi số thẻ";

/** The card reference the correction templates show as their example. */
export const WP0_CARD_REFERENCE_EXAMPLE = "T3-142";

/** Message templates, keyed by id. Ordering is documentation order only. */
export const WP0_MESSAGE_IDS = [
  "welcome",
  "unknown_phrase",
  "gate_rejection",
  "storage_unavailable",
  "media_fetch_failed",
  "capture_unstructured_triage",
  "no_open_cards",
  "capture_confirmed",
  "confidential_refused",
  "agent_downtime",
  "agent_recovered",
  "digest_empty",
] as const;

export type Wp0MessageId = (typeof WP0_MESSAGE_IDS)[number];

export interface Wp0MessageTemplate {
  /**
   * Vietnamese template. `{{phrase.<verb>}}` interpolates a canonical phrase
   * out of `WP0_VERB_PHRASES`; every other `{{name}}` is a caller-supplied
   * value that must be declared in `vars`.
   */
  readonly template: string;
  /** Caller-supplied placeholder names, in the order they first appear. */
  readonly vars: readonly string[];
  /**
   * Set only when a delivery or processing attempt failed and must be
   * re-attempted; the template then embeds the matching `WP0_RETRY_NOTICES`
   * clause. `null` means nothing is pending a retry — the message may still ask
   * the engineer for a correction (a card number, a NAS path).
   */
  readonly retryOwner: Wp0RetryOwner | null;
  /** English note on when this message is sent. Never shown to engineers. */
  readonly usage: string;
}

export const WP0_MESSAGE_TEMPLATES: Record<Wp0MessageId, Wp0MessageTemplate> = {
  // Op AC10: the bot's first message to a newly linked engineer, exactly four lines.
  welcome: {
    template: [
      'Chào {{name}}! Mình là trợ lý Paperclip của bạn, nhắn thẳng vào đây là được.',
      'Có việc mới: chuyển tiếp tin nhắn hoặc gửi ảnh rồi nhắn "{{phrase.capture}}", mình mở thẻ giúp bạn.',
      'Muốn biết đang làm gì thì nhắn "{{phrase.brief}}"; gắn ảnh hoặc link vào thẻ thì nhắn "{{phrase.evidence}}".',
      'Quên từ khoá thì nhắn "{{phrase.help}}", mình gửi lại danh sách.',
    ].join("\n"),
    vars: ["name"],
    retryOwner: null,
    usage: "First DM after a Discord account is linked (PC-003 onboarding).",
  },
  unknown_phrase: {
    template:
      'Mình chưa hiểu "{{input}}". Mình nhận các từ khoá: "{{phrase.capture}}", "{{phrase.brief}}", "{{phrase.evidence}}", "{{phrase.digest}}". Nhắn "{{phrase.help}}" để xem đầy đủ, hoặc gửi lại giúp mình bằng một trong các từ trên.',
    vars: ["input"],
    retryOwner: "engineer",
    usage: "Inbound message matched no verb. Must only name phrases this table answers to.",
  },
  // PC-001 AC2 relayed to the engineer as one Vietnamese line naming the card and the filing phrase.
  // The abandoned-card escape routes to the PM on purpose: no WP-0 verb cancels a card, so naming
  // a cancel phrase here would be an instruction the resolver answers with `unknown_phrase`.
  gate_rejection: {
    template:
      'Thẻ {{card}} chưa đóng được vì chưa có bằng chứng nào. Gửi ảnh, tệp hoặc link rồi nhắn "{{phrase.evidence}}" là mình gắn vào thẻ. Nếu thẻ này bị trùng, sai, hoặc không làm nữa thì báo PM xử lý giúp trên Paperclip — việc đó mình chưa làm được.',
    vars: ["card"],
    retryOwner: null,
    usage: "Evidence gate rejected a done transition; surfaced to the engineer via the agent.",
  },
  // Op AC9: MinIO/NAS down. The system owns the retry, so the engineer must not resend.
  storage_unavailable: {
    template:
      "Mình nhận được {{item}} rồi nhưng kho lưu trữ đang lỗi nên chưa gắn vào thẻ {{card}} được. Bạn không cần gửi lại, mình sẽ thử lại trong 5 phút và báo bạn khi xong.",
    vars: ["item", "card"],
    retryOwner: "system",
    usage:
      "Evidence bytes accepted but the object store rejected the write. Send ONLY when the " +
      "pending write is confirmed queued for replay — the text promises a retry (doc/WP0-OPERATIONS.md §8).",
  },
  // Op AC9: the engineer owns the retry, and the idempotency fingerprint is cleared first.
  media_fetch_failed: {
    template:
      "Mình không tải được {{item}} vừa rồi (link ảnh hết hạn hoặc tệp lỗi) nên chưa lưu được gì vào thẻ cả. Bạn gửi lại giúp mình nhé, lần này mình không tính là trùng đâu.",
    vars: ["item"],
    retryOwner: "engineer",
    usage: "Media download from the chat platform failed. Clear the capture fingerprint before sending.",
  },
  // Op AC2: LLM structuring failed twice; the raw message is filed on a triage card, never dropped.
  capture_unstructured_triage: {
    template:
      'Mình chưa đọc ra được nội dung nên đã lưu nguyên tin nhắn vào thẻ phân loại {{card}}, không mất gì cả. Đúng thẻ nào thì trả lời tin này, chỉ ghi số thẻ thôi (ví dụ: T3-142), hoặc nhắn "{{phrase.brief}}" để xem các thẻ của bạn.',
    vars: ["card"],
    retryOwner: null,
    usage: "Structuring output malformed/empty/refusal after one re-prompt.",
  },
  // Op AC2: an engineer with zero open cards routes to the triage card explicitly.
  no_open_cards: {
    template:
      'Bạn chưa có thẻ nào đang mở nên mình để tạm vào thẻ phân loại {{card}}. Có thẻ đúng thì trả lời tin này, chỉ ghi số thẻ thôi (ví dụ: T3-142), hoặc nhắn "{{phrase.capture}}" kèm nội dung việc để mình mở thẻ mới.',
    vars: ["card"],
    retryOwner: null,
    usage: "Capture arrived from an engineer with no open assigned cards.",
  },
  // WP-0 verb 1: one-line confirmation with the correction path.
  capture_confirmed: {
    template:
      "Đã ghi vào thẻ {{card}} — {{summary}}. Sai thẻ thì trả lời tin này, chỉ ghi số thẻ đúng thôi (ví dụ: T3-142), mình chuyển ngay và ghi lại lịch sử.",
    vars: ["card", "summary"],
    retryOwner: null,
    usage: "Successful capture. The correction path is part of the confirmation, not a separate turn.",
  },
  // PC-004 AC3 / C16: confidential content is refused and nothing is stored.
  confidential_refused: {
    template:
      "Nội dung này thuộc dự án bảo mật nên mình không nhận qua chat và không lưu lại gì cả. Bạn bỏ tệp vào thư mục NAS {{path}} rồi nhắn mình đường dẫn, mình chỉ ghi đường dẫn lên thẻ.",
    vars: ["path"],
    retryOwner: null,
    usage: "Confidential-content refusal. Defense in depth only; confidential projects are never onboarded.",
  },
  // Op AC9: downtime longer than 15 minutes sends one status message per affected engineer.
  agent_downtime: {
    template:
      "Hệ thống của mình đang gián đoạn từ {{since}} nên chưa xử lý được tin nhắn của bạn. Tin nhắn đã lưu, không mất, mình sẽ thử lại trong 5 phút và nhắn lại khi chạy được.",
    vars: ["since"],
    retryOwner: "system",
    usage: "Agent runtime unavailable >15 min. Sent once per affected engineer, not per message.",
  },
  agent_recovered: {
    template:
      'Mình chạy lại bình thường rồi, {{count}} tin nhắn bạn gửi lúc gián đoạn đã được xử lý. Nhắn "{{phrase.brief}}" để xem lại thẻ của bạn.',
    vars: ["count"],
    retryOwner: null,
    usage: "Replay finished after a downtime window.",
  },
  // Op AC5: an empty day still sends one line, so an absent digest is visible as a failure.
  digest_empty: {
    template: "Báo cáo ngày {{date}}: hôm nay chưa có bằng chứng nào được nộp.",
    vars: ["date"],
    retryOwner: null,
    usage: "Digest for a day with zero evidence rows. Never suppress the send.",
  },
};

const PLACEHOLDER_PATTERN = /\{\{([a-z][a-z0-9_.]*)\}\}/g;

const PHRASE_PLACEHOLDER_PREFIX = "phrase.";

/**
 * Normalizes an inbound engineer message for phrase lookup: trims, lowercases,
 * collapses internal whitespace, and drops trailing punctuation. Diacritics are
 * deliberately preserved — the no-diacritic spellings are explicit aliases, so
 * every accepted form is visible in the table rather than implied by a folding
 * rule.
 */
export function normalizeWp0Phrase(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .replace(/[.!?,;:]+$/u, "")
    .trim();
}

function buildPhraseIndex(): ReadonlyMap<string, Wp0VerbId> {
  const index = new Map<string, Wp0VerbId>();
  for (const verbId of WP0_VERB_IDS) {
    const phrase = WP0_VERB_PHRASES[verbId];
    for (const form of [phrase.canonical, ...phrase.aliases]) {
      index.set(normalizeWp0Phrase(form), verbId);
    }
  }
  return index;
}

const PHRASE_INDEX = buildPhraseIndex();

/** Every accepted spelling, normalized, mapped to its verb. */
export function wp0PhraseIndex(): ReadonlyMap<string, Wp0VerbId> {
  return PHRASE_INDEX;
}

/**
 * Resolves an inbound message to a verb, or `null` when nothing matches.
 *
 * This is verb matching and nothing else — a lookup in `wp0PhraseIndex()`. It
 * returns `null` for a card number, a NAS path, or free-form capture text, all
 * of which are legitimate inbound turns. Run `resolveWp0CardReference()` first
 * (see the module header); reply with `unknown_phrase` only when both return
 * `null`.
 */
export function resolveWp0Verb(input: string): Wp0VerbId | null {
  return PHRASE_INDEX.get(normalizeWp0Phrase(input)) ?? null;
}

/**
 * A bare card reference as an engineer types it on a phone: `T3-142`, `t3-142`,
 * `#T3-142`, or just `142` when they drop the company prefix. The prefix is
 * `companies.issue_prefix` (short, alphanumeric, e.g. `T3` / `PAP`), so this
 * pattern is shape-only — the consumer still has to resolve it against the
 * engineer's own cards (PC-003 AC2 scoping) before writing anything.
 */
export const WP0_CARD_REFERENCE_PATTERN = /^#?(?:([a-z][a-z0-9]{0,9})-)?(\d{1,7})$/iu;

/**
 * Reads the card reference out of the CORRECTION turn the capture templates
 * ask for (`WP0_CARD_REPLY_INSTRUCTION`), returning it in canonical form
 * (`T3-142`, or `142` when no prefix was typed), or `null` when the message is
 * not a bare card reference.
 *
 * Shape only, and whole-message only: the pattern is anchored, so "thẻ T3-142"
 * or "T3-142 nhé" is NOT a card reference. That is why the copy asks for the
 * number alone — op AC10 means a message can never advertise a reply the
 * resolver rejects, and `capture_confirmed`, `capture_unstructured_triage` and
 * `no_open_cards` all advertise this one.
 *
 * Not the classifier: whether a bare number IS a correction depends on there
 * being a capture to correct. Call `classifyWp0Inbound()`, which requires that
 * context, rather than this function on its own.
 */
export function resolveWp0CardReference(input: string): string | null {
  const match = WP0_CARD_REFERENCE_PATTERN.exec(normalizeWp0Phrase(input));
  if (!match) return null;
  const prefix = match[1];
  const number = match[2] as string;
  return prefix ? `${prefix.toUpperCase()}-${number}` : number;
}

/**
 * What the bot is waiting for on this DM thread when the next message arrives.
 * Required — not optional, not defaulted — because the correction turn only
 * exists relative to a capture: see `classifyWp0Inbound()`.
 */
export interface Wp0InboundContext {
  /**
   * The card the bot last confirmed a capture on for this engineer (the card a
   * bare number would be correcting), or `null` when nothing is pending.
   */
  readonly pendingCaptureCardId: string | null;
}

export type Wp0InboundClassification =
  | { kind: "correction"; cardReference: string; correctsCardId: string }
  | { kind: "verb"; verb: Wp0VerbId }
  | { kind: "unknown" };

/**
 * The inbound consumer contract from the module header, as code: card
 * reference first, verb second, `unknown_phrase` only when both miss.
 *
 * `context` is required on purpose. The correction turn is **reply-scoped** —
 * the templates that ask for it (`WP0_CARD_REPLY_INSTRUCTION`) are all replies
 * to a capture the bot just confirmed. Without a pending capture there is
 * nothing to correct, so a standalone "142" is treated as unrecognized input
 * rather than as a card number: an engineer DMing a meter reading or a quantity
 * must never re-file evidence onto whatever card was last confirmed. Making the
 * pending capture an argument means a consumer has to decide that question
 * instead of inheriting a silent default.
 */
export function classifyWp0Inbound(input: string, context: Wp0InboundContext): Wp0InboundClassification {
  const cardReference = resolveWp0CardReference(input);
  if (cardReference && context.pendingCaptureCardId) {
    return { kind: "correction", cardReference, correctsCardId: context.pendingCaptureCardId };
  }
  const verb = resolveWp0Verb(input);
  if (verb) return { kind: "verb", verb };
  return { kind: "unknown" };
}

/**
 * Renders one message template. Phrase placeholders resolve out of the table;
 * every declared var must be supplied, and undeclared vars are rejected — a
 * template that silently renders `{{card}}` is worse than a throw.
 */
export function renderWp0Message(id: Wp0MessageId, vars: Record<string, string> = {}): string {
  const entry = WP0_MESSAGE_TEMPLATES[id];
  for (const name of Object.keys(vars)) {
    if (!entry.vars.includes(name)) {
      throw new Error(`WP-0 message "${id}" does not declare variable "${name}"`);
    }
  }
  return entry.template.replace(PLACEHOLDER_PATTERN, (_match, name: string) => {
    if (name.startsWith(PHRASE_PLACEHOLDER_PREFIX)) {
      const verbId = name.slice(PHRASE_PLACEHOLDER_PREFIX.length) as Wp0VerbId;
      const phrase = WP0_VERB_PHRASES[verbId];
      if (!phrase) {
        throw new Error(`WP-0 message "${id}" names unknown verb "${verbId}"`);
      }
      return phrase.canonical;
    }
    const value = vars[name];
    if (value === undefined) {
      throw new Error(`WP-0 message "${id}" requires variable "${name}"`);
    }
    return value;
  });
}

/** Placeholder names used by a template, split into phrase refs and caller vars. */
export function wp0MessagePlaceholders(id: Wp0MessageId): { phrases: string[]; vars: string[] } {
  const phrases: string[] = [];
  const vars: string[] = [];
  for (const match of WP0_MESSAGE_TEMPLATES[id].template.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1] as string;
    if (name.startsWith(PHRASE_PLACEHOLDER_PREFIX)) {
      const verb = name.slice(PHRASE_PLACEHOLDER_PREFIX.length);
      if (!phrases.includes(verb)) phrases.push(verb);
    } else if (!vars.includes(name)) {
      vars.push(name);
    }
  }
  return { phrases, vars };
}

/**
 * The reply to the help verb — and, verbatim, the PC-003 Vietnamese quickstart
 * appendix. Generated from the table so it can never drift from what the bot
 * actually accepts.
 */
export function renderWp0HelpMessage(): string {
  const lines = ["Mình nhận các từ khoá sau (viết có dấu hay không dấu đều được):"];
  for (const verbId of WP0_VERB_IDS) {
    const phrase = WP0_VERB_PHRASES[verbId];
    lines.push(`- "${phrase.canonical}" — ${phrase.help}`);
  }
  lines.push("Gửi ảnh hoặc chuyển tiếp tin nhắn thì mình tự hiểu, không cần gõ từ khoá.");
  return lines.join("\n");
}

/**
 * The phrase contract as it is injected into the `eng-<name>` agent system
 * prompt. English framing (prompts stay English), Vietnamese phrases quoted
 * verbatim so the agent cannot paraphrase them into something the resolver
 * would reject.
 */
export function renderWp0AgentPromptSection(): string {
  const lines = [
    "WP-0 Vietnamese phrase contract (canonical table; do not invent phrases).",
    "Answer to exactly these phrases, and never name a phrase that is not listed here.",
    "",
  ];
  for (const verbId of WP0_VERB_IDS) {
    const phrase = WP0_VERB_PHRASES[verbId];
    const aliases = phrase.aliases.map((alias) => `"${alias}"`).join(", ");
    lines.push(
      `- ${verbId} (${phrase.gloss}; audience: ${phrase.audience}) -> canonical "${phrase.canonical}"; also accepted: ${aliases}`,
    );
  }
  lines.push(
    "",
    `Retry ownership: when the system will retry, say "${WP0_RETRY_NOTICES.system}"; when the engineer must resend, say "${WP0_RETRY_NOTICES.engineer}". Never both in one message.`,
    "Captured content stays verbatim Vietnamese; it is evidence, never translated at capture.",
  );
  return lines.join("\n");
}
