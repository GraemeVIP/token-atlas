import type { Lane, RateLimit, Row, ToolRow } from "./types";
import { LANE_LABEL, rowTotal } from "./agg";
import { compact, full, parseDay, shortDate } from "./agg";

export type Severity = "critical" | "warning" | "notice";

export interface Finding {
  id: string;
  severity: Severity;
  /** Short, specific, contains the number. */
  title: string;
  /** What was measured. */
  detail: string;
  /** Why the user should care — the point of this whole tool. */
  why: string;
  /** What to actually do about it. */
  action: string;
  /** 0..1, drives the inline bar. Omitted when a share is meaningless. */
  share?: number;
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  warning: "Warning",
  notice: "Worth knowing",
};

export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "var(--critical)",
  warning: "var(--warning)",
  notice: "var(--series-1)",
};

const RANK: Record<Severity, number> = { critical: 0, warning: 1, notice: 2 };

/* ------------------------------------------------------------------ */
/* robust statistics                                                   */
/* ------------------------------------------------------------------ */

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Median absolute deviation. Used instead of a standard deviation because a
 * single huge spike inflates the mean and its own deviation, which hides the
 * very outlier we are looking for.
 */
function mad(xs: number[], med: number): number {
  return median(xs.map((x) => Math.abs(x - med)));
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/* ------------------------------------------------------------------ */
/* detectors                                                           */
/* ------------------------------------------------------------------ */

export function detect(
  rows: Row[],
  tools: ToolRow[],
  rateLimit: RateLimit | null,
): Finding[] {
  const out: Finding[] = [];
  const total = sum(rows.map(rowTotal));
  if (!total) return out;

  const byLane = (l: Lane) =>
    sum(rows.filter((r) => r.lane === l).map(rowTotal));
  const turnsOf = (l: Lane) =>
    sum(rows.filter((r) => r.lane === l).map((r) => r.turns));

  const mainTok = byLane("main");
  const subTok = byLane("subagent");
  const reviewTok = byLane("auto-review");
  const autoTok = byLane("automation");
  const invisible = subTok + reviewTok + autoTok;
  const invisibleShare = invisible / total;

  /* 1 ── the flagship: how much ran without you watching --------------- */
  if (invisibleShare >= 0.25) {
    const sev: Severity =
      invisibleShare >= 0.6 ? "critical" : invisibleShare >= 0.4 ? "warning" : "notice";
    const parts = [
      subTok > 0 ? `subagents ${compact(subTok)}` : null,
      reviewTok > 0 ? `auto review ${compact(reviewTok)}` : null,
      autoTok > 0 ? `automation ${compact(autoTok)}` : null,
    ].filter(Boolean);
    out.push({
      id: "invisible-burn",
      severity: sev,
      title: `${(invisibleShare * 100).toFixed(0)}% of your tokens were spent outside the thread you were watching`,
      detail: `${compact(invisible)} of ${compact(total)} went to ${parts.join(", ")}.`,
      why: "These are requests you never saw scroll past. Spawned agents, background review and scheduled runs each keep their own conversation, so they consume quota at their own pace with no visible signal in the session you are actually reading.",
      action:
        "Filter the lane dropdown to each of these in turn to see which model and effort it used, then decide whether that work needed to happen at that setting.",
      share: invisibleShare,
    });
  }

  /* 2 ── one setting dominating everything ---------------------------- */
  const combos = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.model} at ${r.effort} effort in ${LANE_LABEL[r.lane].toLowerCase()}`;
    combos.set(k, (combos.get(k) ?? 0) + rowTotal(r));
  }
  const topCombo = [...combos].sort((a, b) => b[1] - a[1])[0];
  if (topCombo && topCombo[1] / total >= 0.25 && combos.size > 1) {
    const share = topCombo[1] / total;
    out.push({
      id: "dominant-combo",
      severity: share >= 0.4 ? "warning" : "notice",
      title: `${topCombo[0]} is ${(share * 100).toFixed(0)}% of everything`,
      detail: `${compact(topCombo[1])} of ${compact(total)} came from this single combination.`,
      why: "When one model-and-effort pairing dominates this heavily, your whole bill effectively tracks that one setting. It is also the highest-leverage thing to change: nothing else you adjust will move the total as much.",
      action:
        "Check whether that work genuinely needs this model at this effort. Dropping one notch here outweighs every other saving available.",
      share,
    });
  }

  /* 3 ── a day that blew past the others ------------------------------ */
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + rowTotal(r));
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (days.length >= 8) {
    const vals = days.map((d) => d[1]);
    const med = median(vals);
    const dev = mad(vals, med);
    const [spikeDay, spikeVal] = days.reduce((a, b) => (b[1] > a[1] ? b : a));
    // Iglewicz–Hoaglin modified z-score; fall back to a ratio when MAD is 0.
    const z = dev > 0 ? (0.6745 * (spikeVal - med)) / dev : 0;
    const ratio = med > 0 ? spikeVal / med : 0;
    if ((z > 3.5 || (dev === 0 && ratio >= 3)) && ratio >= 3) {
      const dayRows = rows.filter((r) => r.day === spikeDay);
      const driver = new Map<string, number>();
      for (const r of dayRows) {
        const k = `${r.model} in ${LANE_LABEL[r.lane].toLowerCase()}`;
        driver.set(k, (driver.get(k) ?? 0) + rowTotal(r));
      }
      const top = [...driver].sort((a, b) => b[1] - a[1])[0];
      out.push({
        id: "spike-day",
        severity: ratio >= 8 ? "warning" : "notice",
        title: `${shortDate(parseDay(spikeDay))} burned ${compact(spikeVal)} — ${ratio.toFixed(0)}× a typical day`,
        detail: `Your median day in this window is ${compact(med)}. ${top ? `Most of the spike was ${top[0]} (${compact(top[1])}).` : ""}`,
        why: "A single day this far above your baseline is usually one long runaway session or an agent that kept retrying, not a genuine change in how much work you did. It is the kind of thing that quietly eats a weekly allowance in an afternoon.",
        action:
          "Switch the range to that week and use the Day view to confirm, then check which project and lane it came from.",
      });
    }
  }

  /* 4 ── effort escalation -------------------------------------------- */
  const hiEffort = sum(
    rows.filter((r) => r.effort === "max" || r.effort === "ultra").map(rowTotal),
  );
  const hiShare = hiEffort / total;
  if (hiShare >= 0.45) {
    out.push({
      id: "effort-escalation",
      severity: hiShare >= 0.7 ? "warning" : "notice",
      title: `${(hiShare * 100).toFixed(0)}% of tokens ran at max or ultra reasoning effort`,
      detail: `${compact(hiEffort)} of ${compact(total)} was spent at the top two effort levels.`,
      why: "Effort multiplies the private reasoning a model does before it answers — the same question can cost several times more at max than at high. Because effort is usually set once and then forgotten, it tends to apply to routine work that never needed it.",
      action:
        "Look at the Reasoning effort table. If max is being applied to ordinary edits and file reads, lower the default and raise it deliberately for hard problems.",
      share: hiShare,
    });
  }

  /* 5 ── background review as a tax on real work ----------------------- */
  if (reviewTok > 0 && mainTok > 0) {
    const overhead = reviewTok / mainTok;
    if (overhead >= 0.1) {
      out.push({
        id: "review-overhead",
        severity: overhead >= 0.25 ? "warning" : "notice",
        title: `Automatic review costs ${(overhead * 100).toFixed(0)}% of what your actual work costs`,
        detail: `${compact(reviewTok)} on auto review against ${compact(mainTok)} in the main thread.`,
        why: "Auto review runs on its own, checking proposed actions in the background. It is useful, but it is billed to you per action rather than per task, so it scales with how many steps your agent takes rather than with how much you asked for.",
        action:
          "If the ratio looks wrong for the value it adds, review its trigger settings in Codex.",
        share: Math.min(1, overhead),
      });
    }
  }

  /* 6 ── subagent fan-out ---------------------------------------------- */
  const mainTurns = turnsOf("main");
  const subTurns = turnsOf("subagent") + turnsOf("auto-review");
  if (mainTurns >= 50 && subTurns / Math.max(1, mainTurns) >= 2) {
    const x = subTurns / mainTurns;
    out.push({
      id: "subagent-fanout",
      severity: x >= 5 ? "warning" : "notice",
      title: `Background agents made ${x.toFixed(1)}× more model calls than you did`,
      detail: `${full(subTurns)} requests from spawned agents and review, against ${full(mainTurns)} from your own thread.`,
      why: "One instruction from you can fan out into hundreds of requests, because each spawned agent runs its own full loop of calling tools and re-reading context. The count you see in your session is not the count you pay for.",
      action:
        "Check the Subagents table for which agent is doing the fanning out, and whether it needs to run at the model and effort it is using.",
    });
  }

  /* 7 ── context bloat: how much context is replayed per request -------- */
  const perProject = new Map<string, { cache: number; turns: number }>();
  for (const r of rows) {
    const c = perProject.get(r.project) ?? { cache: 0, turns: 0 };
    c.cache += r.cacheRead;
    c.turns += r.turns;
    perProject.set(r.project, c);
  }
  const rates = [...perProject.entries()]
    .filter(([, v]) => v.turns >= 200)
    .map(([k, v]) => [k, v.cache / v.turns, v.turns] as const);
  if (rates.length >= 3) {
    const medRate = median(rates.map((r) => r[1]));
    const worst = rates.reduce((a, b) => (b[1] > a[1] ? b : a));
    if (medRate > 0 && worst[1] / medRate >= 2) {
      out.push({
        id: "context-bloat",
        severity: worst[1] / medRate >= 3.5 ? "warning" : "notice",
        title: `“${worst[0]}” replays ${compact(worst[1])} of context on every request`,
        detail: `That is ${(worst[1] / medRate).toFixed(1)}× your median project (${compact(medRate)} per request), across ${full(worst[2])} requests.`,
        why: "Everything already in a conversation is re-sent on every single turn. Once a session accumulates large files and long tool output, each further step drags that whole payload along again — so cost per step keeps climbing even when the remaining work is small.",
        action:
          "Start fresh sessions for unrelated tasks, and prefer targeted reads over pulling large files into context.",
      });
    }
  }

  /* 8 ── one tool flooding the context --------------------------------- */
  const byTool = new Map<string, number>();
  for (const t of tools) byTool.set(t.tool, (byTool.get(t.tool) ?? 0) + t.calls);
  const allCalls = sum([...byTool.values()]);
  const topTool = [...byTool].sort((a, b) => b[1] - a[1])[0];
  if (topTool && allCalls >= 500 && topTool[1] / allCalls >= 0.4) {
    const share = topTool[1] / allCalls;
    out.push({
      id: "tool-storm",
      severity: "notice",
      title: `“${topTool[0]}” accounts for ${(share * 100).toFixed(0)}% of all tool calls`,
      detail: `${full(topTool[1])} calls out of ${full(allCalls)}.`,
      why: "Tool calls are not billed as tokens themselves, but every result is pasted into the conversation and then re-sent on every later turn. A tool called this often with verbose output is one of the main reasons context — and the cache-read bill — grows.",
      action:
        "Where that tool returns long output, narrowing it at the source keeps it out of context permanently.",
      share,
    });
  }

  /* 9 ── plan pressure -------------------------------------------------- */
  if (rateLimit && rateLimit.usedPercent >= 80) {
    out.push({
      id: "plan-pressure",
      severity: rateLimit.usedPercent >= 95 ? "critical" : "warning",
      title: `Codex plan is ${rateLimit.usedPercent.toFixed(0)}% used`,
      detail: `On a ${Math.round(rateLimit.windowMinutes / 1440)}-day rolling window${
        rateLimit.resetsAt
          ? `, resetting ${new Date(rateLimit.resetsAt * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
          : ""
      }.`,
      why: "This is the most recent reading in your logs and it is independent of the date filter. At this level you are close to being rate limited mid-task, which tends to happen at the least convenient moment.",
      action:
        "The findings above show what is consuming it fastest; the background lanes are usually the easiest to cut without losing work.",
      share: rateLimit.usedPercent / 100,
    });
  }

  return out.sort(
    (a, b) => RANK[a.severity] - RANK[b.severity] || (b.share ?? 0) - (a.share ?? 0),
  );
}
