"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { Lane, RateLimit, Row, ScanResult, Source, ToolRow } from "@/lib/types";
import {
  addDays,
  applyFilters,
  applyToolFilters,
  compact,
  LANE_LABEL,
  TOKEN_KINDS,
  WEIGHTS,
  dayKey,
  distinct,
  dowShort,
  foldTail,
  full,
  groupBy,
  KIND_COLOR,
  KIND_LABEL,
  KIND_ORDER,
  LANE_COLOR,
  METRIC_LABEL,
  type Filters,
  type Metric,
  parseDay,
  pct,
  series,
  shortDate,
  SRC_COLOR,
  SRC_LABEL,
  sum,
  sumField,
  weekLabel,
  weekStart,
} from "@/lib/agg";
import {
  CompositionBar,
  Legend,
  Meter,
  RankBars,
  StackedColumns,
  StatTile,
  type Part,
  type RankItem,
} from "./charts";
import {
  CardHead,
  ExplainerBody,
  HowToRead,
  InfoTip,
  type Explainer,
} from "./info";
import { Findings } from "./findings";
import { detect } from "@/lib/anomalies";

/* ------------------------------------------------------------------ */

type RangeKey = "week" | "prevweek" | "4w" | "90d" | "all";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "week", label: "This week" },
  { key: "prevweek", label: "Last week" },
  { key: "4w", label: "4 weeks" },
  { key: "90d", label: "90 days" },
  { key: "all", label: "All time" },
];

const LANES: Lane[] = ["main", "subagent", "auto-review", "automation"];

export default function Dashboard() {
  const [data, setData] = useState<ScanResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  // controls
  const [range, setRange] = useState<RangeKey>("all");
  const [weekOffset, setWeekOffset] = useState(0);
  const [metric, setMetric] = useState<Metric>("total");
  const [gran, setGran] = useState<"auto" | "day" | "week">("auto");
  const [src, setSrc] = useState<Source | "all">("all");
  const [lane, setLane] = useState<Lane | "all">("all");
  const [model, setModel] = useState<string>("all");
  const [project, setProject] = useState<string>("all");

  /* theme ---------------------------------------------------------- */
  // The inline script in the layout already stamped data-theme before paint;
  // adopt that value rather than re-deriving it and forcing a second swap.
  useEffect(() => {
    const stamped = document.documentElement.getAttribute("data-theme");
    setTheme(stamped === "dark" ? "dark" : "light");
  }, []);
  useEffect(() => {
    if (!theme) return;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ta-theme", theme);
  }, [theme]);

  /* load ----------------------------------------------------------- */
  const load = async (force = false) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/usage${force ? "?force=1" : ""}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load(false);
  }, []);

  /* ---------------------------------------------------------------- */
  const allRows = data?.rows ?? [];
  const allTools = data?.tools ?? [];

  const bounds = useMemo(() => {
    if (!allRows.length) return null;
    const days = allRows.map((r) => r.day).sort();
    return { first: days[0], last: days[days.length - 1] };
  }, [allRows]);

  // Resolve the active window. Weeks run Saturday → Friday.
  const window_ = useMemo(() => {
    const today = new Date();
    const thisWeek = weekStart(today);
    if (range === "week" || range === "prevweek") {
      const base = range === "prevweek" ? -1 : 0;
      const ws = addDays(thisWeek, (base + weekOffset) * 7);
      return { from: ws, to: addDays(ws, 6) };
    }
    if (range === "4w") return { from: addDays(thisWeek, -21), to: addDays(thisWeek, 6) };
    if (range === "90d") return { from: addDays(today, -89), to: today };
    return bounds
      ? { from: parseDay(bounds.first), to: parseDay(bounds.last) }
      : { from: addDays(today, -30), to: today };
  }, [range, weekOffset, bounds]);

  const filters: Filters = useMemo(
    () => ({
      src,
      lane,
      model,
      project,
      from: dayKey(window_.from),
      to: dayKey(window_.to),
    }),
    [src, lane, model, project, window_],
  );

  const rows = useMemo(() => applyFilters(allRows, filters), [allRows, filters]);
  const tools = useMemo(() => applyToolFilters(allTools, filters), [allTools, filters]);

  // Previous equal-length window, for deltas.
  const prevRows = useMemo(() => {
    const days =
      Math.round((+window_.to - +window_.from) / 86400000) + 1;
    return applyFilters(allRows, {
      ...filters,
      from: dayKey(addDays(window_.from, -days)),
      to: dayKey(addDays(window_.from, -1)),
    });
  }, [allRows, filters, window_]);

  const total = sum(rows, metric);
  const prevTotal = sum(prevRows, metric);
  const delta =
    prevTotal > 0 ? { pct: ((total - prevTotal) / prevTotal) * 100, label: "vs prev" } : null;

  const spanDays = Math.round((+window_.to - +window_.from) / 86400000) + 1;
  const granularity = gran === "auto" ? (spanDays > 31 ? "week" : "day") : gran;

  const modelOpts = useMemo(() => distinct(allRows, (r) => r.model), [allRows]);
  const projectOpts = useMemo(() => distinct(allRows, (r) => r.project), [allRows]);

  // Anomalies are always computed on RAW tokens: the weighted lens is a
  // comparison aid, and thresholds tuned against it would shift meaning.
  const findings = useMemo(
    () => detect(rows, tools, data?.rateLimit ?? null),
    [rows, tools, data?.rateLimit],
  );

  /* ---------------------------------------------------------------- */
  if (err) {
    return (
      <Shell theme={theme} setTheme={setTheme} onRefresh={() => load(true)} busy={busy}>
        <div className="card" style={{ borderColor: "var(--critical)" }}>
          <h2 className="card-title" style={{ color: "var(--critical)" }}>
            Scan failed
          </h2>
          <p className="card-sub">{err}</p>
        </div>
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell theme={theme} setTheme={setTheme} onRefresh={() => load(true)} busy={busy}>
        <Loading />
      </Shell>
    );
  }

  const missing = data.meta.missing;

  return (
    <Shell
      theme={theme}
      setTheme={setTheme}
      onRefresh={() => load(true)}
      busy={busy}
      meta={data.meta}
    >
      {missing.length > 0 && (
        <div
          className="card"
          style={{ borderColor: "var(--warning)", marginBottom: 16 }}
        >
          <h2 className="card-title">Some sources were not found</h2>
          <p className="card-sub">
            No logs at {missing.join(" or ")} — those tools show as empty.
          </p>
        </div>
      )}

      {/* ---- filter row: one row, scoping everything below ---------- */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          marginBottom: 18,
          opacity: busy ? 0.55 : 1,
          transition: "opacity .15s",
        }}
      >
        <div className="seg">
          {RANGES.map((r) => (
            <button
              key={r.key}
              aria-pressed={range === r.key}
              onClick={() => {
                setRange(r.key);
                setWeekOffset(0);
              }}
            >
              {r.label}
            </button>
          ))}
        </div>

        {(range === "week" || range === "prevweek") && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              className="btn"
              onClick={() => setWeekOffset((w) => w - 1)}
              aria-label="Previous week"
            >
              ‹
            </button>
            <span
              className="tnum"
              style={{
                fontSize: 12.5,
                color: "var(--text-secondary)",
                minWidth: 108,
                textAlign: "center",
              }}
            >
              {weekLabel(window_.from)}
            </span>
            <button
              className="btn"
              onClick={() => setWeekOffset((w) => w + 1)}
              aria-label="Next week"
              disabled={
                range === "week" && weekOffset >= 0
              }
            >
              ›
            </button>
          </div>
        )}

        <div style={{ flex: 1, minWidth: 8 }} />

        <div className="seg">
          <button aria-pressed={src === "all"} onClick={() => setSrc("all")}>
            Both
          </button>
          <button aria-pressed={src === "claude"} onClick={() => setSrc("claude")}>
            Claude Code
          </button>
          <button aria-pressed={src === "codex"} onClick={() => setSrc("codex")}>
            Codex
          </button>
        </div>

        <select
          className="btn"
          value={lane}
          onChange={(e) => setLane(e.target.value as Lane | "all")}
          aria-label="Filter by lane"
        >
          <option value="all">All lanes</option>
          {LANES.map((l) => (
            <option key={l} value={l}>
              {LANE_LABEL[l]}
            </option>
          ))}
        </select>

        <select
          className="btn"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          aria-label="Filter by model"
        >
          <option value="all">All models</option>
          {modelOpts.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <select
          className="btn"
          value={project}
          onChange={(e) => setProject(e.target.value)}
          aria-label="Filter by project"
        >
          <option value="all">All projects</option>
          {projectOpts.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div className="seg">
            <button
              aria-pressed={metric === "total"}
              onClick={() => setMetric("total")}
            >
              Raw
            </button>
            <button
              aria-pressed={metric === "weighted"}
              onClick={() => setMetric("weighted")}
            >
              Weighted
            </button>
          </div>
          <InfoTip label="Raw vs Weighted">
            <ExplainerBody
              what={
                <>
                  <strong>Raw</strong> counts every token equally.{" "}
                  <strong>Weighted</strong> multiplies each kind by its relative
                  cost (cache read ×{WEIGHTS.cacheRead}, fresh input ×
                  {WEIGHTS.input}, cache write ×{WEIGHTS.cacheWrite}, output ×
                  {WEIGHTS.output}). A relative measure for comparison — not a
                  bill, and not in any currency.
                </>
              }
              why="Raw and weighted can rank the same work completely differently. Something that looks like 95% of your usage can be under 60% of the cost, while output jumps from a rounding error to a real share. Check both before concluding anything."
            />
          </InfoTip>
        </div>
      </div>

      <div style={{ opacity: busy ? 0.55 : 1, transition: "opacity .15s" }}>
        <Findings findings={findings} hasData={rows.length > 0} />
      </div>

      <HowToRead />

      <div style={{ opacity: busy ? 0.55 : 1, transition: "opacity .15s" }}>
        <Overview
          rows={rows}
          total={total}
          delta={delta}
          metric={metric}
          window_={window_}
          rateLimit={data.rateLimit}
        />

        <WhereItGoes rows={rows} total={total} metric={metric} />

        <Trend
          rows={rows}
          metric={metric}
          granularity={granularity}
          window_={window_}
          gran={gran}
          setGran={setGran}
        />

        <Composition rows={rows} metric={metric} />

        <Breakdowns rows={rows} tools={tools} total={total} metric={metric} />
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

function Shell({
  children,
  theme,
  setTheme,
  onRefresh,
  busy,
  meta,
}: {
  children: React.ReactNode;
  theme: "light" | "dark" | null;
  setTheme: (t: "light" | "dark") => void;
  onRefresh: () => void;
  busy: boolean;
  meta?: ScanResult["meta"];
}) {
  return (
    <main
      style={{
        maxWidth: 1220,
        margin: "0 auto",
        padding: "26px 22px 72px",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 14,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1
            style={{
              fontSize: 21,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            Token Atlas
          </h1>
          <p className="card-sub" style={{ marginTop: 4 }}>
            Finds where Claude Code and Codex are burning tokens without you
            noticing — background agents, automatic review and runaway sessions.
            Weeks run Saturday → Friday.
            {meta && (
              <>
                {" "}
                <span style={{ opacity: 0.8 }}>
                  {meta.files} log files · {(meta.bytes / 1e9).toFixed(1)} GB ·
                  scanned in {(meta.durationMs / 1000).toFixed(1)}s
                </span>
              </>
            )}
          </p>
        </div>

        <button
          className="btn"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle colour theme"
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
        <button className="btn" onClick={onRefresh} disabled={busy}>
          {busy ? "Scanning…" : "↻ Rescan"}
        </button>
      </header>
      {children}
    </main>
  );
}

function Loading() {
  return (
    <div className="card" style={{ textAlign: "center", padding: "56px 20px" }}>
      <div
        style={{
          width: 26,
          height: 26,
          margin: "0 auto 14px",
          border: "2.5px solid var(--grid)",
          borderTopColor: "var(--series-1)",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }}
      />
      <div style={{ fontSize: 13.5, fontWeight: 500 }}>Reading session logs…</div>
      <p className="card-sub">
        First scan streams every transcript on disk. Later scans reuse a cache and
        are near-instant.
      </p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

function Overview({
  rows,
  total,
  delta,
  metric,
  window_,
  rateLimit,
}: {
  rows: Row[];
  total: number;
  delta: { pct: number; label: string } | null;
  metric: Metric;
  window_: { from: Date; to: Date };
  rateLimit: RateLimit | null;
}) {
  const turns = rows.reduce((s, r) => s + r.turns, 0);
  const output = sumField(rows, "output");
  const cacheRead = sumField(rows, "cacheRead");
  const raw = rows.reduce(
    (s, r) => s + r.input + r.cacheRead + r.cacheWrite + r.output,
    0,
  );
  const reasoning = sumField(rows, "reasoning");
  const thinkChars = sumField(rows, "thinkChars");
  const estThinking = Math.round(thinkChars / 4);

  return (
    <>
      <div
        className="card"
        style={{
          marginBottom: 14,
          display: "flex",
          gap: 26,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div style={{ flex: 1, minWidth: 210 }}>
          <div
            style={{
              fontSize: 11.5,
              color: "var(--text-muted)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {METRIC_LABEL[metric]} · {shortDate(window_.from)} –{" "}
            {shortDate(window_.to)}
            <InfoTip label="Total">
              <ExplainerBody
                what="Every token both agents read and wrote in this window, across all models and lanes. The percentage compares it with the previous window of the same length."
                why="This is the headline number, but on its own it cannot tell you whether it was well spent. The findings panel and the lane breakdown below are what turn it into something you can act on."
              />
            </InfoTip>
          </div>
          <div
            style={{
              fontSize: 52,
              fontWeight: 600,
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
              marginTop: 2,
            }}
          >
            {compact(total)}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
            {full(total)}{" "}
            {metric === "weighted" ? "cost-weighted units" : "tokens"}
            {delta && (
              <span
                style={{
                  marginLeft: 10,
                  fontWeight: 600,
                  color: delta.pct > 0 ? "var(--critical)" : "var(--good)",
                }}
              >
                {delta.pct > 0 ? "▲" : "▼"} {Math.abs(delta.pct).toFixed(0)}% vs
                previous period
              </span>
            )}
          </div>
        </div>

        {rateLimit && (
          <div style={{ minWidth: 230, flex: "none" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11.5,
                color: "var(--text-muted)",
                marginBottom: 6,
              }}
            >
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                Codex plan usage
                {rateLimit.plan ? ` · ${rateLimit.plan}` : ""}
                <InfoTip label="Codex plan usage">
                  <ExplainerBody
                    what="The most recent allowance reading in your logs. A rolling window that resets on the date shown — not affected by the date filter above. Claude Code records no equivalent, so only Codex appears here."
                    why="This is the one number with a hard consequence: hit it and you are cut off mid-task until it resets. The findings above show what is consuming it fastest."
                  />
                </InfoTip>
              </span>
              <span className="tnum" style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                {rateLimit.usedPercent.toFixed(0)}%
              </span>
            </div>
            <Meter value={rateLimit.usedPercent} />
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
              {Math.round(rateLimit.windowMinutes / 1440)}-day window
              {rateLimit.resetsAt
                ? ` · resets ${new Date(rateLimit.resetsAt * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
                : ""}
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(168px, 1fr))",
          gap: 12,
          marginBottom: 22,
        }}
      >
        <StatTile
          label="Requests"
          value={compact(turns)}
          sub={`${full(turns)} turns`}
          info={
            <InfoTip label="Requests">
              <ExplainerBody
                what="One call to a model. A single thing you ask for usually takes many requests, because the agent calls a tool, reads the result, and calls again."
                why="This is the number people underestimate most. You made one request; the agents made tens of thousands. Every one of them re-sends the conversation so far."
              />
            </InfoTip>
          }
        />
        <StatTile
          label="Output tokens"
          value={compact(output)}
          sub={`${pct(output, raw)} of raw`}
          accent={KIND_COLOR.output}
          info={
            <InfoTip label="Output tokens">
              <ExplainerBody
                what="What the models wrote back — replies, code edits, tool calls."
                why="A tiny share of raw volume but the most expensive kind per token, so it matters far more than this percentage suggests. Switch to Weighted to see its real weight."
              />
            </InfoTip>
          }
        />
        <StatTile
          label="Cache reads"
          value={compact(cacheRead)}
          sub={`${pct(cacheRead, raw)} of raw`}
          accent={KIND_COLOR.cacheRead}
          info={
            <InfoTip label="Cache reads">
              <ExplainerBody
                what="The conversation so far, re-sent on every single request."
                why="It dominates the raw count while costing about a tenth as much per token, so it makes totals look alarming for the wrong reason. It does mean long sessions get steadily more expensive per step, because there is more to replay each turn."
              />
            </InfoTip>
          }
        />
        <StatTile
          label="Reasoning (Codex)"
          value={compact(reasoning)}
          sub="measured"
          accent="var(--series-7)"
          info={
            <InfoTip label="Reasoning (Codex)">
              <ExplainerBody
                what="Private thinking tokens spent before answering. Codex reports this as a real number, so this figure is measured, not inferred."
                why="Reasoning is billed as output, the priciest kind, and it is invisible — you never see this text. It scales directly with the reasoning effort setting, which is why effort is the lever that matters."
              />
            </InfoTip>
          }
        />
        <StatTile
          label="Thinking (Claude)"
          value={`~${compact(estThinking)}`}
          sub="estimated from text"
          accent="var(--series-5)"
          info={
            <InfoTip label="Thinking (Claude)">
              <ExplainerBody
                what={
                  <>
                    Claude folds thinking into its output tokens and never
                    reports it separately, so this is an{" "}
                    <strong>estimate</strong> from the length of its thinking
                    text.
                  </>
                }
                why="Shown apart from the Codex figure rather than added to it, because the two are not measured the same way. Treat it as an indication of how much hidden reasoning Claude did, not as an exact count."
              />
            </InfoTip>
          }
        />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Where it goes                                                       */
/* ------------------------------------------------------------------ */

function WhereItGoes({
  rows,
  total,
  metric,
}: {
  rows: Row[];
  total: number;
  metric: Metric;
}) {
  const laneGroups = groupBy(rows, (r) => r.lane, metric);
  const laneItems: RankItem[] = laneGroups.map((g) => ({
    key: g.key,
    label: LANE_LABEL[g.key as Lane] ?? g.key,
    value: g.value,
    color: LANE_COLOR[g.key as Lane] ?? "var(--dim)",
    sub: `${full(g.turns)} requests`,
  }));

  // Coloured by lane, so a hue means the same thing in every chart here.
  const comboGroups = foldTail(
    groupBy(
      rows,
      (r) => `${r.model} · ${r.effort} · ${LANE_LABEL[r.lane]}`,
      metric,
    ),
    8,
  );
  const comboItems: RankItem[] = comboGroups.map((g) => ({
    key: g.key,
    label: g.key,
    value: g.value,
    color:
      g.key === "Other"
        ? "var(--dim)"
        : (LANE_COLOR[g.rows[0]?.lane] ?? "var(--dim)"),
    sub: `${full(g.turns)} requests`,
  }));

  const srcGroups = groupBy(rows, (r) => r.src, metric);

  return (
    <section style={{ marginBottom: 22 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))",
          gap: 14,
        }}
      >
        <div className="card">
          <CardHead
            title="Where the tokens go"
            sub="Every request attributed to the lane that spent it — your own turns, spawned subagents, automatic code review, and scheduled automation."
            info={{
              what: (
                <>
                  Every request assigned to whoever spent it.{" "}
                  <em>Main thread</em> is you talking to the agent.{" "}
                  <em>Subagents</em> are helpers it spawned to work on their own.{" "}
                  <em>Auto review</em> is Codex checking actions in the
                  background. <em>Automation</em> is scheduled runs.
                </>
              ),
              why: "This is the whole point of the tool. Only the main thread is work you actually watched happen — everything else ran on its own, at whatever model and effort it was configured with. If those lanes are large, your quota is being spent by processes you never see, and no amount of typing more carefully will change it.",
            }}
          />
          <div style={{ marginTop: 16 }}>
            <RankBars items={laneItems} total={total} labelWidth={104} />
          </div>
        </div>

        <div className="card">
          <CardHead
            title="Split by tool"
            sub="Claude Code and Codex side by side over the selected window."
            info={{
              what: (
                <>
                  How your two coding agents compare over the selected window.
                  The bar underneath shows the lane mix inside that same window.
                </>
              ),
              why: "They bill separately on separate plans, so one can be close to its limit while the other is idle. Knowing which side a spike came from tells you which allowance is actually at risk.",
            }}
          />
          <div style={{ marginTop: 16 }}>
            <RankBars
              items={srcGroups.map((g) => ({
                key: g.key,
                label: SRC_LABEL[g.key as Source] ?? g.key,
                value: g.value,
                color: SRC_COLOR[g.key as Source] ?? "var(--dim)",
                sub: `${full(g.turns)} requests`,
              }))}
              total={total}
              labelWidth={104}
            />
          </div>
          <div
            style={{
              marginTop: 20,
              paddingTop: 14,
              borderTop: "1px solid var(--grid)",
            }}
          >
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 9 }}>
              Lane mix within the window
            </div>
            <CompositionBar
              parts={laneGroups.map<Part>((g) => ({
                key: g.key,
                label: LANE_LABEL[g.key as Lane] ?? g.key,
                value: g.value,
                color: LANE_COLOR[g.key as Lane] ?? "var(--dim)",
              }))}
              height={26}
            />
            <div style={{ marginTop: 10 }}>
              <Legend
                items={laneGroups.map((g) => ({
                  label: LANE_LABEL[g.key as Lane] ?? g.key,
                  color: LANE_COLOR[g.key as Lane] ?? "var(--dim)",
                }))}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <CardHead
          title="Top burners — model × effort × lane"
          sub="The specific combinations consuming the most. Everything past the top eight is folded into “Other”."
          info={{
            what: (
              <>
                Each bar is one exact combination: which model, at which
                reasoning effort, in which lane. Coloured by lane to match the
                chart above; everything past the top eight is grouped as
                “Other”.
              </>
            ),
            why: "Cost is driven by combinations, not by any single dimension — an expensive model at low effort can be cheaper than a mid model at max. This is the most actionable view on the page: if one row dominates, it is the one setting worth changing, and changing anything else will barely move the total.",
          }}
        />
        <div style={{ marginTop: 16 }}>
          <RankBars items={comboItems} total={total} labelWidth={286} />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Trend                                                               */
/* ------------------------------------------------------------------ */

function Trend({
  rows,
  metric,
  granularity,
  window_,
  gran,
  setGran,
}: {
  rows: Row[];
  metric: Metric;
  granularity: "day" | "week";
  window_: { from: Date; to: Date };
  gran: "auto" | "day" | "week";
  setGran: (g: "auto" | "day" | "week") => void;
}) {
  const buckets = series(rows, granularity, (r) => r.lane, metric, window_);
  const laneSeries = LANES.map((l) => ({
    key: l,
    label: LANE_LABEL[l],
    color: LANE_COLOR[l],
  })).filter((s) => buckets.some((b) => (b.parts[s.key] ?? 0) > 0));

  const todayKey = dayKey(new Date());
  const thisWeekKey = dayKey(weekStart(new Date()));

  const stackBuckets = buckets.map((b) => ({
    label:
      granularity === "day" ? dowShort(b.date) : `${b.date.getDate()} ${shortMonth(b.date)}`,
    sublabel: granularity === "day" ? String(b.date.getDate()) : undefined,
    parts: b.parts,
    total: b.total,
    highlight:
      granularity === "day"
        ? dayKey(b.date) === todayKey
        : dayKey(b.date) === thisWeekKey,
  }));

  return (
    <section className="card" style={{ marginBottom: 22 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 230 }}>
          <CardHead
            title={`${granularity === "week" ? "Weekly" : "Daily"} burn by lane`}
            sub={
              granularity === "week"
                ? "Each column is one Saturday-to-Friday week, labelled by its starting Saturday."
                : "Each column is one day. Weeks begin on Saturday."
            }
            info={{
              what: (
                <>
                  Usage over time, each column split into the same lane colours
                  used above. Weeks run Saturday to Friday, labelled by their
                  starting Saturday. Hover any column for the exact split; the
                  current period is bold.
                </>
              ),
              why: "Totals hide runaway sessions. One afternoon can outweigh a fortnight of normal use, and because the columns are split by lane you can see immediately whether a spike was you working hard or a background agent looping.",
            }}
          />
        </div>
        <div className="seg">
          <button aria-pressed={gran === "auto"} onClick={() => setGran("auto")}>
            Auto
          </button>
          <button aria-pressed={gran === "day"} onClick={() => setGran("day")}>
            Day
          </button>
          <button aria-pressed={gran === "week"} onClick={() => setGran("week")}>
            Week
          </button>
        </div>
      </div>

      <div style={{ marginTop: 8, marginBottom: 14 }}>
        <Legend items={laneSeries.map((s) => ({ label: s.label, color: s.color }))} />
      </div>

      <div className="scroll-x">
        <div style={{ minWidth: Math.max(420, stackBuckets.length * 26) }}>
          <StackedColumns buckets={stackBuckets} series={laneSeries} height={220} />
        </div>
      </div>
    </section>
  );
}

function shortMonth(d: Date) {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
    d.getMonth()
  ];
}

/* ------------------------------------------------------------------ */
/* Composition                                                         */
/* ------------------------------------------------------------------ */

function Composition({ rows, metric }: { rows: Row[]; metric: Metric }) {
  const raw: Record<string, number> = {};
  for (const k of TOKEN_KINDS) raw[k] = sumField(rows, k);
  const rawTotal = Object.values(raw).reduce((s, v) => s + v, 0);

  const weighted: Record<string, number> = {};
  for (const k of TOKEN_KINDS) weighted[k] = raw[k] * WEIGHTS[k];
  const wTotal = Object.values(weighted).reduce((s, v) => s + v, 0);

  const mk = (src: Record<string, number>): Part[] =>
    KIND_ORDER.map((k) => ({
      key: k,
      label: KIND_LABEL[k],
      value: src[k] ?? 0,
      color: KIND_COLOR[k],
    }));

  return (
    <section className="card" style={{ marginBottom: 22 }}>
      <CardHead
        title="What the tokens actually are"
        info={{
          what: (
            <>
              <em>Cache read</em> is the conversation replayed on every turn —
              huge in volume, ~10× cheaper each. <em>Fresh input</em> is text
              the model has not seen. <em>Output</em> is what it writes back,
              the priciest per token. The top bar is volume; the bottom is cost.
            </>
          ),
          why: "Judging usage by raw token count is misleading, and it is the mistake almost everyone makes. Cache reads swamp the raw number while costing a tenth as much, so a long session looks alarming when it is cheap, and a short burst of heavy output looks trivial when it is not.",
        }}
      />
      <p className="card-sub">
        Raw volume is dominated by cache reads — replaying context you already
        paid to write. Weighted applies each kind’s relative billing cost
        (cache read ×{WEIGHTS.cacheRead}, cache write ×{WEIGHTS.cacheWrite},
        output ×{WEIGHTS.output}), which is a truer picture of expense.
      </p>

      <div style={{ marginTop: 18 }}>
        <Row2 label="By raw volume" total={rawTotal}>
          <CompositionBar parts={mk(raw)} />
        </Row2>
        <div style={{ height: 16 }} />
        <Row2 label="By billing weight" total={wTotal} unit="weighted">
          <CompositionBar parts={mk(weighted)} />
        </Row2>
      </div>

      <div style={{ marginTop: 16 }}>
        <Legend
          items={KIND_ORDER.map((k) => ({ label: KIND_LABEL[k], color: KIND_COLOR[k] }))}
        />
      </div>

      <div className="scroll-x" style={{ marginTop: 18 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Token kind</th>
              <th className="num">Raw</th>
              <th className="num">Share</th>
              <th className="num">Weight</th>
              <th className="num">Weighted</th>
              <th className="num">Weighted share</th>
            </tr>
          </thead>
          <tbody>
            {KIND_ORDER.map((k) => (
              <tr key={k}>
                <td>
                  <span
                    style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                  >
                    <i className="legend-swatch" style={{ background: KIND_COLOR[k] }} />
                    {KIND_LABEL[k]}
                  </span>
                </td>
                <td className="num">{full(raw[k] ?? 0)}</td>
                <td className="num">{pct(raw[k] ?? 0, rawTotal)}</td>
                <td className="num">×{WEIGHTS[k]}</td>
                <td className="num">{full(weighted[k] ?? 0)}</td>
                <td className="num">{pct(weighted[k] ?? 0, wTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Row2({
  label,
  total,
  unit,
  children,
}: {
  label: string;
  total: number;
  unit?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11.5,
          color: "var(--text-muted)",
          marginBottom: 7,
        }}
      >
        <span>{label}</span>
        <span className="tnum">
          {compact(total)} {unit ?? "tokens"}
        </span>
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Breakdown tables                                                    */
/* ------------------------------------------------------------------ */

function Breakdowns({
  rows,
  tools,
  total,
  metric,
}: {
  rows: Row[];
  tools: ToolRow[];
  total: number;
  metric: Metric;
}) {
  return (
    <>
      {/* Six columns; given a full-width row so it never has to scroll. */}
      <div style={{ marginBottom: 14 }}>
        <SubagentTable rows={rows} metric={metric} />
      </div>

      <section
        style={{
          display: "grid",
          // wide enough that the four numeric columns fit without the card
          // falling back to a nested horizontal scroll
          gridTemplateColumns: "repeat(auto-fit, minmax(430px, 1fr))",
          gap: 14,
        }}
      >
      <DimTable
        title="Models"
        sub="Exact model id as recorded in the logs."
        rows={rows}
        keyfn={(r) => r.model}
        total={total}
        metric={metric}
        info={{
          what: (
            <>
              The exact model id each request ran on, straight from the logs —
              no grouping or renaming.
            </>
          ),
          why: "Agents switch models on your behalf, for subagents and background jobs especially. A model high in this list with relatively few requests is an expensive one, and it may be running somewhere you never selected it.",
        }}
      />
      <DimTable
        title="Reasoning effort"
        sub="The effort level each request ran at."
        rows={rows}
        keyfn={(r) => r.effort}
        total={total}
        metric={metric}
        info={{
          what: (
            <>
              How hard the model was told to think before answering, from{" "}
              <em>low</em> through <em>high</em>, <em>xhigh</em>, <em>max</em>{" "}
              and <em>ultra</em>. <em>none</em> means the log recorded no effort
              setting.
            </>
          ),
          why: "Effort is the cost multiplier people forget. It is usually set once and then applies to everything, so routine edits and file reads end up running at the same expensive setting you chose for a hard problem.",
        }}
      />
      <DimTable
        title="Projects"
        sub="Working directory the session ran in."
        rows={rows}
        keyfn={(r) => r.project}
        total={total}
        metric={metric}
        info={{
          what: (
            <>
              The folder each session ran in — in practice, the project you were
              working on.
            </>
          ),
          why: "Spend is rarely spread evenly. One project usually dominates, and seeing which one turns an abstract total into something you can recognise and account for.",
        }}
      />
      <ToolTable tools={tools} />
      <DimTable
        title="Model × effort"
        sub="Which effort levels dominate each model."
        rows={rows}
        keyfn={(r) => `${r.model} · ${r.effort}`}
        total={total}
        metric={metric}
        info={{
          what: <>The two settings that most affect cost, crossed together.</>,
          why: "Neither number means much alone. This pairing is what actually sets the price of a request, so if one row sits well above the rest, dropping just that pairing a notch is usually the single biggest saving available.",
        }}
      />
      </section>
    </>
  );
}

/**
 * Subagent spend broken out to the grain that actually explains it:
 * which agent, running which model, at which reasoning effort.
 */
function SubagentTable({ rows, metric }: { rows: Row[]; metric: Metric }) {
  const [expanded, setExpanded] = useState(false);
  const sub = rows.filter((r) => r.lane === "subagent" || r.lane === "auto-review");
  const groups = groupBy(
    sub,
    (r) => `${r.agent || "subagent"} ${r.model} ${r.effort}`,
    metric,
  );
  const laneTotal = groups.reduce((s, g) => s + g.value, 0);
  const shown = expanded ? groups : groups.slice(0, 9);

  return (
    <div className="card">
      <CardHead
        title="Subagents — agent × model × effort"
        sub="Every agent spawned on your behalf, and exactly what it was running. Shares are of subagent + auto-review spend, not the whole window."
        info={{
          what: (
            <>
              Each agent spawned on your behalf, the model it ran, and the
              effort it ran at. <em>Spawned worker</em> is a general task agent;{" "}
              <em>auto-review</em> is Codex's background reviewer;{" "}
              <em>sidechain</em> is a Claude Code subagent.
            </>
          ),
          why: "Subagents are the least visible spend on the page and often the largest. Each gets its own conversation and its own context window, inherits a model and effort you probably never chose per-agent, and one instruction from you can fan out into thousands of their requests.",
        }}
      />
      {!groups.length ? (
        <p className="card-sub" style={{ marginTop: 14 }}>
          No subagent activity in this window.
        </p>
      ) : (
        <>
          <div className="scroll-x" style={{ marginTop: 14 }}>
            <table className="tbl wide">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Model</th>
                  <th>Effort</th>
                  <th className="num">Tokens</th>
                  <th className="num">Share</th>
                  <th className="num">Requests</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((g) => {
                  const [agent, mdl, eff] = g.key.split(" ");
                  const lane = g.rows[0]?.lane ?? "subagent";
                  return (
                    <tr key={g.key}>
                      <td>
                        <span
                          style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
                        >
                          <i
                            className="legend-swatch"
                            style={{ background: LANE_COLOR[lane] }}
                          />
                          {agent}
                        </span>
                      </td>
                      <td>{mdl}</td>
                      <td>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: "2px 7px",
                            borderRadius: 5,
                            background: "var(--ghost)",
                            border: "1px solid var(--border)",
                            color: "var(--text-secondary)",
                          }}
                        >
                          {eff}
                        </span>
                      </td>
                      <td className="num">{compact(g.value)}</td>
                      <td className="num">{pct(g.value, laneTotal)}</td>
                      <td className="num">{full(g.turns)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {groups.length > 9 && (
            <button
              className="btn"
              style={{ marginTop: 12 }}
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? "Show less" : `Show all ${groups.length}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function DimTable({
  title,
  sub,
  rows,
  keyfn,
  total,
  metric,
  emptyNote,
  info,
}: {
  title: string;
  sub: string;
  rows: Row[];
  keyfn: (r: Row) => string;
  total: number;
  metric: Metric;
  emptyNote?: string;
  info?: Explainer;
}) {
  const [expanded, setExpanded] = useState(false);
  const groups = groupBy(rows, keyfn, metric);
  const shown = expanded ? groups : groups.slice(0, 8);

  return (
    <div className="card">
      <CardHead title={title} sub={sub} info={info} />
      {groups.length === 0 ? (
        <p className="card-sub" style={{ marginTop: 14 }}>
          {emptyNote ?? "Nothing in this window."}
        </p>
      ) : (
        <>
          <div className="scroll-x" style={{ marginTop: 14 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>{title.replace(/s$/, "")}</th>
                  <th className="num">Tokens</th>
                  <th className="num">Share</th>
                  <th className="num">Requests</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((g) => (
                  <tr key={g.key}>
                    <td title={g.key} style={{ maxWidth: 210 }}>
                      <div
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {g.key || "—"}
                      </div>
                      <div
                        style={{
                          height: 3,
                          marginTop: 5,
                          borderRadius: 2,
                          background: "var(--series-1)",
                          width: `${Math.max((g.value / (groups[0]?.value || 1)) * 100, 1)}%`,
                          opacity: 0.55,
                        }}
                      />
                    </td>
                    <td className="num">{compact(g.value)}</td>
                    <td className="num">{pct(g.value, total)}</td>
                    <td className="num">{full(g.turns)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {groups.length > 8 && (
            <button
              className="btn"
              style={{ marginTop: 12 }}
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? "Show less" : `Show all ${groups.length}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ToolTable({ tools }: { tools: ToolRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const map = new Map<string, { tool: string; calls: number; src: Source }>();
  for (const t of tools) {
    const key = `${t.src}|${t.tool}`;
    const cur = map.get(key);
    if (cur) cur.calls += t.calls;
    else map.set(key, { tool: t.tool, calls: t.calls, src: t.src });
  }
  const list = [...map.values()].sort((a, b) => b.calls - a.calls);
  const totalCalls = list.reduce((s, t) => s + t.calls, 0);
  const shown = expanded ? list : list.slice(0, 8);

  return (
    <div className="card">
      <CardHead
        title="Tool calls"
        sub="What the agents actually did. Tool results are the main thing that grows a context window, so heavy tools drive the cache-read bill indirectly."
        info={{
          what: (
            <>
              Counts of each tool the agents invoked. These are{" "}
              <strong>call counts, not tokens</strong> — tokens cannot be
              attributed to a tool directly.
            </>
          ),
          why: "Tool output is the main thing that inflates a context window. Every result is pasted into the conversation and then re-sent on every following turn, so one chatty tool quietly raises the price of every step that comes after it.",
        }}
      />
      {!list.length ? (
        <p className="card-sub" style={{ marginTop: 14 }}>
          No tool calls in this window.
        </p>
      ) : (
        <>
          <div className="scroll-x" style={{ marginTop: 14 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Source</th>
                  <th className="num">Calls</th>
                  <th className="num">Share</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={`${t.src}|${t.tool}`}>
                    <td
                      title={t.tool}
                      style={{
                        maxWidth: 210,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.tool}
                    </td>
                    <td>
                      <span
                        style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
                      >
                        <i
                          className="legend-swatch"
                          style={{ background: SRC_COLOR[t.src] }}
                        />
                        {SRC_LABEL[t.src]}
                      </span>
                    </td>
                    <td className="num">{full(t.calls)}</td>
                    <td className="num">{pct(t.calls, totalCalls)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.length > 8 && (
            <button
              className="btn"
              style={{ marginTop: 12 }}
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? "Show less" : `Show all ${list.length}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
