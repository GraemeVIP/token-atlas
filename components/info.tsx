"use client";

import React, { useEffect, useId, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/* InfoTip — a "?" affordance that explains a section in plain words.   */
/* Works on hover, keyboard focus and tap; Escape closes it.            */
/* The same text also lives in the glossary below, so the tooltip only  */
/* ever enhances — it never gates the explanation.                      */
/* ------------------------------------------------------------------ */

export interface Explainer {
  /** What this section shows. */
  what: React.ReactNode;
  /** Why it is worth caring about — never omitted. */
  why: React.ReactNode;
}

export function ExplainerBody({ what, why }: Explainer) {
  return (
    <>
      <span style={{ display: "block" }}>{what}</span>
      <span
        style={{
          display: "block",
          marginTop: 7,
          paddingTop: 7,
          borderTop: "1px solid var(--grid)",
        }}
      >
        <strong style={{ color: "var(--text-primary)" }}>Why it matters:</strong>{" "}
        {why}
      </span>
    </>
  );
}

export function InfoTip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const [canHover, setCanHover] = useState(true);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);

  // On touch a tap emits a synthetic mouseover *and* a click; wiring both
  // would open then immediately close it. Only trust hover where it's real.
  useEffect(() => {
    setCanHover(window.matchMedia("(hover: hover)").matches);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  // Flip toward the left when there isn't room on the right.
  useEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setFlip(r.left + 300 > window.innerWidth);
  }, [open]);

  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        className="infodot"
        aria-label={`What does “${label}” mean?`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={canHover ? () => setOpen(true) : undefined}
        onMouseLeave={canHover ? () => setOpen(false) : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="infopop"
          style={flip ? { right: 0, left: "auto" } : undefined}
        >
          {children}
        </span>
      )}
    </span>
  );
}

/** Card heading with its explainer attached. */
export function CardHead({
  title,
  sub,
  info,
}: {
  title: string;
  sub?: string;
  info?: Explainer;
}) {
  return (
    <>
      <h2
        className="card-title"
        style={{ display: "flex", alignItems: "center", gap: 7 }}
      >
        {title}
        {info && (
          <InfoTip label={title}>
            {/* passed explicitly, not spread: spreading an object into JSX
                trips React's key-prop warning if it ever carries one */}
            <ExplainerBody what={info.what} why={info.why} />
          </InfoTip>
        )}
      </h2>
      {sub && <p className="card-sub">{sub}</p>}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Glossary / orientation panel                                        */
/* ------------------------------------------------------------------ */

const TERMS: { term: string; def: string }[] = [
  {
    term: "Token",
    def: "The unit models read and write — very roughly ¾ of a word. Everything here is counted in tokens.",
  },
  {
    term: "Request",
    def: "One call to a model. A single thing you ask for usually takes many requests, because the agent calls a tool, reads the result, and calls again.",
  },
  {
    term: "Fresh input",
    def: "Text sent to the model that it has not been sent before — your prompt, a file it just read. Charged at the normal input rate.",
  },
  {
    term: "Cache read",
    def: "The conversation so far, re-sent on every request. The provider keeps a copy, so this is about 10× cheaper than fresh input — but it is re-sent every single turn, which is why it dominates the raw count.",
  },
  {
    term: "Cache write",
    def: "The cost of storing context so later turns can cache-read it instead of paying full price. A small premium now to save a lot later.",
  },
  {
    term: "Output",
    def: "What the model writes back: its reply, its code edits, its tool calls. The most expensive kind per token, which is why it looms much larger in the weighted view.",
  },
  {
    term: "Reasoning",
    def: "Private thinking the model does before answering. Codex reports it as a real number; Claude folds it into output and never breaks it out, so that tile is an estimate from the length of its thinking text.",
  },
  {
    term: "Reasoning effort",
    def: "How hard the model was told to think — low, medium, high, xhigh, max, ultra. Higher effort means more reasoning tokens and a bigger bill for the same question.",
  },
  {
    term: "Lane",
    def: "Who spent the tokens: you in the main thread, a subagent, automatic review, or scheduled automation. This is the fastest way to see where your usage really goes.",
  },
  {
    term: "Subagent",
    def: "A helper the agent spawns to go do a sub-task. It runs its own separate conversation with its own context, so it can quietly cost more than the thread you are actually watching.",
  },
  {
    term: "Auto review",
    def: "Codex's automatic reviewer. It checks proposed actions in the background and logs under its own model id, so its cost is separated out here.",
  },
  {
    term: "Raw vs Weighted",
    def: "Raw counts every token equally. Weighted multiplies each kind by its relative cost (cache read ×0.1, fresh input ×1, cache write ×1.25, output ×5) so the ranking reflects expense rather than volume. It is a relative measure, not a bill.",
  },
];

export function HowToRead() {
  const [open, setOpen] = useState(false);

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 className="card-title">New here? How to read this</h2>
          <p className="card-sub">
            Plain-English guide to every section, plus what the jargon means.
          </p>
        </div>
        <button
          className="btn"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? "Hide guide" : "Show guide"}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 18 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
              gap: 14,
              marginBottom: 22,
            }}
          >
            <Step
              n={1}
              title="Start with the big number"
              body="Total tokens for the window you picked at the top. Change the window with the buttons on the left — weeks run Saturday to Friday."
            />
            <Step
              n={2}
              title="Then “Where the tokens go”"
              body="This answers the real question. If “Subagents” or “Auto review” is large, work you never watched directly is spending your quota."
            />
            <Step
              n={3}
              title="Check “What the tokens actually are”"
              body="Nearly all raw tokens are cache reads — the conversation replayed each turn. Flip to Weighted to see cost rather than volume."
            />
            <Step
              n={4}
              title="Drill into the tables"
              body="Model, reasoning effort, project, subagent and tool. Every table shares the filters at the top of the page."
            />
          </div>

          <h3
            style={{
              fontSize: 12,
              fontWeight: 600,
              margin: "0 0 10px",
              color: "var(--text-primary)",
            }}
          >
            Glossary
          </h3>
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))",
              gap: "12px 26px",
              margin: 0,
            }}
          >
            {TERMS.map((t) => (
              <div key={t.term}>
                <dt
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                  }}
                >
                  {t.term}
                </dt>
                <dd
                  style={{
                    margin: "2px 0 0",
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: "var(--text-secondary)",
                  }}
                >
                  {t.def}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 19,
            height: 19,
            borderRadius: "50%",
            background: "var(--series-1)",
            color: "#fff",
            fontSize: 11,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          {n}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{title}</span>
      </div>
      <p
        style={{
          margin: "6px 0 0",
          fontSize: 12,
          lineHeight: 1.5,
          color: "var(--text-secondary)",
        }}
      >
        {body}
      </p>
    </div>
  );
}
