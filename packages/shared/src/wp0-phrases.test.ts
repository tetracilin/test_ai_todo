import { describe, expect, it } from "vitest";
import {
  WP0_CARD_REFERENCE_EXAMPLE,
  WP0_CARD_REPLY_INSTRUCTION,
  WP0_MESSAGE_IDS,
  WP0_MESSAGE_TEMPLATES,
  WP0_RETRY_NOTICES,
  WP0_RETRY_OWNERS,
  WP0_VERB_IDS,
  WP0_VERB_PHRASES,
  classifyWp0Inbound,
  normalizeWp0Phrase,
  renderWp0AgentPromptSection,
  renderWp0HelpMessage,
  renderWp0Message,
  resolveWp0CardReference,
  resolveWp0Verb,
  wp0MessagePlaceholders,
  wp0PhraseIndex,
} from "./wp0-phrases.js";
import type { Wp0MessageId, Wp0VerbId } from "./wp0-phrases.js";

/**
 * Placeholder values good enough to render any template for structural checks.
 * The angle brackets are a sentinel: a quoted span that still carries one came
 * from a caller-supplied var, not from the phrase table, so the op AC10 sweep
 * below skips it.
 */
function sampleVars(id: Wp0MessageId): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const name of WP0_MESSAGE_TEMPLATES[id].vars) {
    vars[name] = `<${name}>`;
  }
  return vars;
}

const CALLER_VAR_SENTINEL = /^<[a-z0-9_]+>$/u;

/**
 * Card actions the WP-0 bot deliberately does not answer to: no verb cancels,
 * deletes, or reassigns a card. Naming one in engineer-facing copy sends the
 * engineer into `unknown_phrase` with no way out — the op AC10 failure mode.
 * The assertion is conditional rather than absolute on purpose: if a cancel
 * path ever ships, add the verb to `WP0_VERB_PHRASES` and this list stops
 * failing without anyone having to remember to edit it.
 */
const UNSUPPORTED_CARD_ACTIONS = [
  "huỷ thẻ",
  "hủy thẻ",
  "xoá thẻ",
  "xóa thẻ",
  "bỏ thẻ",
  "đổi người",
  "chuyển người",
];

describe("WP0_VERB_PHRASES", () => {
  it("covers the four WP-0 verbs plus the help verb", () => {
    expect([...WP0_VERB_IDS]).toEqual(["capture", "brief", "evidence", "digest", "help"]);
    expect(Object.keys(WP0_VERB_PHRASES).sort()).toEqual([...WP0_VERB_IDS].sort());
  });

  it("gives every verb a canonical phrase, an English gloss, and a Vietnamese help line", () => {
    for (const verbId of WP0_VERB_IDS) {
      const phrase = WP0_VERB_PHRASES[verbId];
      expect(phrase.canonical.trim(), verbId).not.toBe("");
      expect(phrase.gloss.trim(), verbId).not.toBe("");
      expect(phrase.help.trim(), verbId).not.toBe("");
      expect(phrase.aliases.length, verbId).toBeGreaterThan(0);
    }
  });

  it("never lets an accepted spelling collide across verbs", () => {
    const owner = new Map<string, Wp0VerbId>();
    for (const verbId of WP0_VERB_IDS) {
      const phrase = WP0_VERB_PHRASES[verbId];
      for (const form of [phrase.canonical, ...phrase.aliases]) {
        const normalized = normalizeWp0Phrase(form);
        expect(normalized, `${verbId}: "${form}" normalizes to empty`).not.toBe("");
        const existing = owner.get(normalized);
        expect(existing, `"${form}" is claimed by both ${existing} and ${verbId}`).toBeUndefined();
        owner.set(normalized, verbId);
      }
    }
    expect(owner.size).toBe(wp0PhraseIndex().size);
  });

  it("keeps at least one diacritic-free spelling per verb", () => {
    for (const verbId of WP0_VERB_IDS) {
      const phrase = WP0_VERB_PHRASES[verbId];
      const asciiForms = [phrase.canonical, ...phrase.aliases].filter((form) => /^[\x20-\x7e]+$/u.test(form));
      expect(asciiForms.length, `${verbId} has no diacritic-free alias`).toBeGreaterThan(0);
    }
  });
});

describe("resolveWp0Verb", () => {
  it("resolves every canonical phrase and every alias", () => {
    for (const verbId of WP0_VERB_IDS) {
      const phrase = WP0_VERB_PHRASES[verbId];
      for (const form of [phrase.canonical, ...phrase.aliases]) {
        expect(resolveWp0Verb(form), form).toBe(verbId);
      }
    }
  });

  it("tolerates the casing, spacing, and trailing punctuation a phone keyboard produces", () => {
    expect(resolveWp0Verb("  Ghi   Nhận  ")).toBe("capture");
    expect(resolveWp0Verb("TÓM TẮT!")).toBe("brief");
    expect(resolveWp0Verb("tro giup?")).toBe("help");
  });

  it("returns null for anything the table does not answer to", () => {
    expect(resolveWp0Verb("xoá thẻ")).toBeNull();
    expect(resolveWp0Verb("huỷ thẻ")).toBeNull();
    expect(resolveWp0Verb("")).toBeNull();
    expect(resolveWp0Verb("brieff")).toBeNull();
  });
});

describe("resolveWp0CardReference", () => {
  it("accepts the shapes an engineer types when correcting a mis-filed capture", () => {
    expect(resolveWp0CardReference("T3-142")).toBe("T3-142");
    expect(resolveWp0CardReference("t3-142")).toBe("T3-142");
    expect(resolveWp0CardReference("#T3-142")).toBe("T3-142");
    expect(resolveWp0CardReference("  T3-142.  ")).toBe("T3-142");
    expect(resolveWp0CardReference("142")).toBe("142");
    expect(resolveWp0CardReference("#142")).toBe("142");
  });

  it("does not swallow verbs or free-form text", () => {
    for (const verbId of WP0_VERB_IDS) {
      const phrase = WP0_VERB_PHRASES[verbId];
      for (const form of [phrase.canonical, ...phrase.aliases]) {
        expect(resolveWp0CardReference(form), form).toBeNull();
      }
    }
    expect(resolveWp0CardReference("")).toBeNull();
    expect(resolveWp0CardReference("thẻ 142")).toBeNull();
    expect(resolveWp0CardReference("máy bơm hỏng rồi")).toBeNull();
  });

  // The defect this pins: the capture templates ask for a bare card number, and
  // the verb resolver returns null for one. A consumer that only asks
  // `resolveWp0Verb` answers the correction with `unknown_phrase` and the
  // mis-file is never fixed.
  it("classifies a bare card number as a correction rather than unknown input", () => {
    for (const reply of ["T3-142", "142", "#T3-142"]) {
      expect(resolveWp0Verb(reply), reply).toBeNull();
      expect(classifyWp0Inbound(reply, PENDING_CAPTURE), reply).toEqual({
        kind: "correction",
        cardReference: expect.any(String),
        correctsCardId: PENDING_CAPTURE.pendingCaptureCardId,
      });
    }
    expect(classifyWp0Inbound("ghi nhận", PENDING_CAPTURE)).toEqual({ kind: "verb", verb: "capture" });
    expect(classifyWp0Inbound("huỷ thẻ", PENDING_CAPTURE)).toEqual({ kind: "unknown" });
  });

  // The correction turn is reply-scoped: with no capture pending there is
  // nothing to correct, so a bare number is NOT a card reference. An engineer
  // DMing a meter reading ("142") must never re-file evidence onto the card the
  // bot last confirmed. The context argument is required so a consumer has to
  // answer this question rather than inherit a silent default.
  it("never reads a bare number as a correction when no capture is pending", () => {
    for (const reply of ["142", "T3-142", "#T3-142"]) {
      expect(classifyWp0Inbound(reply, NOTHING_PENDING), reply).toEqual({ kind: "unknown" });
    }
    // Verbs stay verbs with or without a pending capture.
    expect(classifyWp0Inbound("tóm tắt", NOTHING_PENDING)).toEqual({ kind: "verb", verb: "brief" });
  });
});

const PENDING_CAPTURE = { pendingCaptureCardId: "11111111-2222-3333-4444-555555555555" } as const;
const NOTHING_PENDING = { pendingCaptureCardId: null } as const;

describe("WP0_MESSAGE_TEMPLATES", () => {
  it("declares one template per message id", () => {
    expect(Object.keys(WP0_MESSAGE_TEMPLATES).sort()).toEqual([...WP0_MESSAGE_IDS].sort());
  });

  // Op AC10: "a rejection can never name a phrase the bot doesn't answer to."
  it("only names phrases the table answers to", () => {
    for (const id of WP0_MESSAGE_IDS) {
      const { phrases } = wp0MessagePlaceholders(id);
      for (const verb of phrases) {
        expect(WP0_VERB_IDS as readonly string[], `${id} names unknown verb "${verb}"`).toContain(verb);
      }
      const rendered = renderWp0Message(id, sampleVars(id));
      for (const verb of phrases) {
        expect(rendered, id).toContain(WP0_VERB_PHRASES[verb as Wp0VerbId].canonical);
      }
    }
  });

  // Op AC10, enforced on the rendered text and not only on {{phrase.*}} tokens:
  // a template that quotes a literal Vietnamese phrase is telling the engineer
  // to send exactly that, so it must resolve like any other advertised phrase.
  it("quotes nothing in any template that the resolver cannot answer", () => {
    for (const id of WP0_MESSAGE_IDS) {
      const rendered = renderWp0Message(id, sampleVars(id));
      for (const match of rendered.matchAll(/"([^"]+)"/gu)) {
        const quoted = match[1] as string;
        if (CALLER_VAR_SENTINEL.test(quoted)) continue; // engineer's own words, echoed back
        expect(resolveWp0Verb(quoted), `${id} quotes unresolvable phrase "${quoted}"`).not.toBeNull();
      }
    }
  });

  // Op AC10 again, on the failure this artifact exists to prevent: a literal
  // instruction ("báo mình huỷ thẻ") is invisible to the placeholder sweep and
  // still leaves the engineer looped between a message and a resolver.
  it("never instructs an engineer to ask for a card action no verb resolves", () => {
    const bodies: Array<[string, string]> = WP0_MESSAGE_IDS.map((id) => [
      id,
      renderWp0Message(id, sampleVars(id)),
    ]);
    bodies.push(["help", renderWp0HelpMessage()]);
    for (const [label, body] of bodies) {
      for (const action of UNSUPPORTED_CARD_ACTIONS) {
        if (!body.includes(action)) continue;
        expect(
          resolveWp0Verb(action),
          `${label} names "${action}", which the phrase table does not answer to`,
        ).not.toBeNull();
      }
    }
  });

  // Op AC10 on the correction path: a template that asks for a card number is
  // advertising a reply `resolveWp0CardReference()` has to be able to answer.
  // The resolver anchors the whole message, so the copy must ask for the number
  // ALONE — copy that invited it alongside other words ("kèm số thẻ") sent
  // "thẻ T3-142" and "T3-142 nhé" straight to `unknown_phrase`.
  it("asks for the card number in the one shape the resolver answers to", () => {
    const askers = WP0_MESSAGE_IDS.filter((id) => renderWp0Message(id, sampleVars(id)).includes("số thẻ"));
    expect(askers).toEqual(["capture_unstructured_triage", "no_open_cards", "capture_confirmed"]);
    for (const id of askers) {
      const rendered = renderWp0Message(id, sampleVars(id));
      expect(rendered, `${id} does not use the canonical correction instruction`).toContain(
        WP0_CARD_REPLY_INSTRUCTION,
      );
      // Anything the copy offers as an example must itself resolve.
      const examples = [...rendered.matchAll(/\(ví dụ:\s*([^)]+)\)/gu)].map((m) => (m[1] as string).trim());
      expect(examples.length, `${id} shows no example card reference`).toBeGreaterThan(0);
      for (const example of examples) {
        expect(resolveWp0CardReference(example), `${id} shows unresolvable example "${example}"`).not.toBeNull();
      }
    }
    expect(resolveWp0CardReference(WP0_CARD_REFERENCE_EXAMPLE)).toBe(WP0_CARD_REFERENCE_EXAMPLE);
    // The shapes the old "kèm số thẻ" wording invited, which never resolved.
    for (const embedded of ["thẻ T3-142", "T3-142 nhé", "đúng ra là 142", "chuyển sang 142"]) {
      expect(resolveWp0CardReference(embedded), embedded).toBeNull();
      expect(classifyWp0Inbound(embedded, PENDING_CAPTURE), embedded).toEqual({ kind: "unknown" });
    }
  });

  it("keeps declared vars and used placeholders in sync", () => {
    for (const id of WP0_MESSAGE_IDS) {
      const { vars } = wp0MessagePlaceholders(id);
      expect([...WP0_MESSAGE_TEMPLATES[id].vars].sort(), id).toEqual([...vars].sort());
    }
  });

  it("renders every template with no placeholder left behind", () => {
    for (const id of WP0_MESSAGE_IDS) {
      const rendered = renderWp0Message(id, sampleVars(id));
      expect(rendered, id).not.toMatch(/\{\{/u);
      expect(rendered.trim(), id).not.toBe("");
    }
  });

  it("throws rather than rendering a missing or undeclared variable", () => {
    expect(() => renderWp0Message("gate_rejection")).toThrow(/requires variable "card"/u);
    expect(() => renderWp0Message("gate_rejection", { card: "T3-142", nope: "x" })).toThrow(
      /does not declare variable "nope"/u,
    );
  });

  // Op AC9: the failure reply states who retries — and only one of them.
  it("states exactly one retry owner on every failure message", () => {
    for (const id of WP0_MESSAGE_IDS) {
      const { retryOwner } = WP0_MESSAGE_TEMPLATES[id];
      const rendered = renderWp0Message(id, sampleVars(id));
      for (const owner of WP0_RETRY_OWNERS) {
        const shouldContain = owner === retryOwner;
        expect(rendered.includes(WP0_RETRY_NOTICES[owner]), `${id} / ${owner}`).toBe(shouldContain);
      }
    }
  });

  it("assigns retry ownership to the messages that report a failed attempt", () => {
    const byOwner: Record<string, Wp0MessageId[]> = { system: [], engineer: [] };
    for (const id of WP0_MESSAGE_IDS) {
      const owner = WP0_MESSAGE_TEMPLATES[id].retryOwner;
      if (owner) byOwner[owner]?.push(id);
    }
    expect(byOwner.system).toEqual(["storage_unavailable", "agent_downtime"]);
    expect(byOwner.engineer).toEqual(["unknown_phrase", "media_fetch_failed"]);
  });

  // Op AC10: "the bot's 4-line Vietnamese first message to a newly linked engineer".
  it("keeps the welcome message to four lines", () => {
    const rendered = renderWp0Message("welcome", { name: "anh Hùng" });
    expect(rendered.split("\n")).toHaveLength(4);
    expect(rendered).toContain("anh Hùng");
  });

  // PC-001 AC2: the gate rejection names the card, the accepted evidence types,
  // and the filing phrase — and names no escape the bot cannot honour.
  it("names the card and the evidence phrase in the gate rejection", () => {
    const rendered = renderWp0Message("gate_rejection", { card: "T3-142" });
    expect(rendered).toContain("T3-142");
    expect(rendered).toContain(WP0_VERB_PHRASES.evidence.canonical);
    expect(resolveWp0Verb(WP0_VERB_PHRASES.evidence.canonical)).toBe("evidence");
    for (const evidenceType of ["ảnh", "tệp", "link"]) {
      expect(rendered, evidenceType).toContain(evidenceType);
    }
    for (const action of UNSUPPORTED_CARD_ACTIONS) {
      expect(rendered, `gate rejection offers "${action}" as an escape`).not.toContain(action);
    }
  });
});

describe("renderWp0HelpMessage", () => {
  it("returns the whole table, and nothing the table cannot answer", () => {
    const help = renderWp0HelpMessage();
    for (const verbId of WP0_VERB_IDS) {
      const phrase = WP0_VERB_PHRASES[verbId];
      expect(help, verbId).toContain(`"${phrase.canonical}"`);
      expect(help, verbId).toContain(phrase.help);
    }
    for (const quoted of help.matchAll(/"([^"]+)"/gu)) {
      expect(resolveWp0Verb(quoted[1] as string), quoted[1]).not.toBeNull();
    }
  });
});

describe("renderWp0AgentPromptSection", () => {
  it("quotes every accepted spelling so the prompt cannot paraphrase one away", () => {
    const section = renderWp0AgentPromptSection();
    for (const verbId of WP0_VERB_IDS) {
      const phrase = WP0_VERB_PHRASES[verbId];
      for (const form of [phrase.canonical, ...phrase.aliases]) {
        expect(section, form).toContain(`"${form}"`);
      }
      expect(section, verbId).toContain(phrase.gloss);
    }
  });

  it("carries both retry-ownership clauses for the agent to choose between", () => {
    const section = renderWp0AgentPromptSection();
    expect(section).toContain(WP0_RETRY_NOTICES.system);
    expect(section).toContain(WP0_RETRY_NOTICES.engineer);
  });
});
