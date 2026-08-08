"use client";

import React, { useCallback, useRef, useState } from "react";
import { compact, full, pct } from "@/lib/agg";

/* ------------------------------------------------------------------ */
/* Tooltip                                                             */
/* ------------------------------------------------------------------ */

export interface TipRow {
  label: string;
  value: string;
  color?: string;
}
export interface TipData {
  x: number;
  y: number;
  title: string;
  rows: TipRow[];
}

export function Tooltip({ tip }: { tip: TipData | null }) {
  if (!tip) return null;
  // Flip near the right/bottom edge so the tip never leaves the viewport.
  const flipX = tip.x > window.innerWidth - 220;
  const flipY = tip.y > window.innerHeight - 150;
  return (
    <div
      className="tip"
      style={{
        left: flipX ? tip.x - 12 : tip.x + 14,
        top: flipY ? tip.y - 12 : tip.y + 14,
        transform: `translate(${flipX ? "-100%" : "0"}, ${flipY ? "-100%" : "0"})`,
      }}
      role="status"
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{tip.title}</div>
      {tip.rows.map((r, i) => (
        <div className="tip-row" key={i}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {r.color && (
              <i
                className="legend-swatch"
                style={{ background: r.color, display: "inline-block" }}
              />
            )}
            <span style={{ color: "var(--text-secondary)" }}>{r.label}</span>
          </span>
          <span>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function useTip() {
  const [tip, setTip] = useState<TipData | null>(null);
  const show = useCallback(
    (e: React.MouseEvent, title: string, rows: TipRow[]) =>
      setTip({ x: e.clientX, y: e.clientY, title, rows }),
    [],
  );
  const hide = useCallback(() => setTip(null), []);
  return { tip, show, hide };
}

/* ------------------------------------------------------------------ */
/* Legend                                                              */
/* ------------------------------------------------------------------ */

export function Legend({
  items,
}: {
  items: { label: string; color: string }[];
}) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span className="legend-item" key={it.label}>
          <i className="legend-swatch" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Composition bar — one stacked bar, part-to-whole                    */
/* ------------------------------------------------------------------ */

export interface Part {
  key: string;
  label: string;
  value: number;
  color: string;
}

/**
 * A single horizontal stacked bar. Segments are separated by a 2px surface
 * gap (never a stroke). Labels render inside only when they measurably fit.
 */
export function CompositionBar({
  parts,
  height = 34,
  showLabels = true,
}: {
  parts: Part[];
  height?: number;
  showLabels?: boolean;
}) {
  const { tip, show, hide } = useTip();
  const total = parts.reduce((s, p) => s + p.value, 0);
  const shown = parts.filter((p) => p.value > 0);
  if (!total) return <EmptyBar height={height} />;

  return (
    <>
      <div
        style={{ display: "flex", gap: 2, height, width: "100%" }}
        role="img"
        aria-label={shown
          .map((p) => `${p.label} ${pct(p.value, total)}`)
          .join(", ")}
      >
        {shown.map((p) => {
          const share = p.value / total;
          // ~7px per char + padding; only label if it genuinely fits.
          const approxPx = share * 100;
          const fits = showLabels && approxPx > 11;
          return (
            <div
              key={p.key}
              style={{
                flex: `${share} 1 0`,
                background: p.color,
                borderRadius: 5,
                minWidth: 3,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "default",
              }}
              onMouseMove={(e) =>
                show(e, p.label, [
                  { label: "Tokens", value: full(p.value), color: p.color },
                  { label: "Share", value: pct(p.value, total) },
                ])
              }
              onMouseLeave={hide}
            >
              {fits && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#fff",
                    mixBlendMode: "normal",
                    textShadow: "0 1px 2px rgba(0,0,0,0.25)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {pct(p.value, total)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <Tooltip tip={tip} />
    </>
  );
}

function EmptyBar({ height }: { height: number }) {
  return (
    <div
      style={{
        height,
        borderRadius: 5,
        background: "var(--ghost)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        color: "var(--text-muted)",
      }}
    >
      No data in range
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ranked horizontal bars                                              */
/* ------------------------------------------------------------------ */

export interface RankItem {
  key: string;
  label: string;
  value: number;
  color: string;
  sub?: string;
}

/** Bars grow from a single baseline; value labels ride the tip. */
export function RankBars({
  items,
  total,
  labelWidth = 132,
}: {
  items: RankItem[];
  total?: number;
  labelWidth?: number;
}) {
  const { tip, show, hide } = useTip();
  const max = Math.max(...items.map((i) => i.value), 1);
  const whole = total ?? items.reduce((s, i) => s + i.value, 0);
  if (!items.length) return <EmptyBar height={80} />;

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {items.map((it) => (
          <div
            key={it.key}
            style={{ display: "flex", alignItems: "center", gap: 10 }}
            onMouseMove={(e) =>
              show(e, it.label, [
                { label: "Tokens", value: full(it.value), color: it.color },
                { label: "Share", value: pct(it.value, whole) },
                ...(it.sub ? [{ label: "Detail", value: it.sub }] : []),
              ])
            }
            onMouseLeave={hide}
          >
            <div
              style={{
                width: labelWidth,
                flex: "none",
                fontSize: 12.5,
                color: "var(--text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={it.label}
            >
              {it.label}
            </div>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                height: 16,
                display: "flex",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  width: `${Math.max((it.value / max) * 100, 0.6)}%`,
                  height: "100%",
                  background: it.color,
                  // square at the baseline, 4px rounded at the data end
                  borderRadius: "2px 4px 4px 2px",
                }}
              />
            </div>
            <div
              className="tnum"
              style={{
                width: 96,
                flex: "none",
                textAlign: "right",
                fontSize: 12.5,
                color: "var(--text-secondary)",
              }}
            >
              {compact(it.value)}
              <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>
                {pct(it.value, whole)}
              </span>
            </div>
          </div>
        ))}
      </div>
      <Tooltip tip={tip} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Stacked column chart (time series)                                  */
/* ------------------------------------------------------------------ */

export interface StackSeries {
  key: string;
  label: string;
  color: string;
}

export interface StackBucket {
  label: string;
  sublabel?: string;
  parts: Record<string, number>;
  total: number;
  highlight?: boolean;
}

/**
 * Stacked columns with a hairline grid, 2px surface gaps between segments,
 * and a hover band wider than the column itself so the hit target is comfortable.
 */
export function StackedColumns({
  buckets,
  series,
  height = 210,
  maxBarWidth = 24,
  yTicks = 4,
}: {
  buckets: StackBucket[];
  series: StackSeries[];
  height?: number;
  maxBarWidth?: number;
  yTicks?: number;
}) {
  const { tip, show, hide } = useTip();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  if (!buckets.length) return <EmptyBar height={height} />;

  const max = Math.max(...buckets.map((b) => b.total), 1);
  const nice = niceMax(max, yTicks);
  const plotH = height;

  // Thin x labels when columns get dense, so they never overlap.
  const labelStep = Math.ceil(buckets.length / 16);

  return (
    <>
      {/* top padding keeps the highest y-tick from being clipped by the
          horizontal scroll container this chart usually sits inside */}
      <div ref={wrapRef} style={{ position: "relative", paddingTop: 8 }}>
        {/* gridlines + y ticks */}
        <div style={{ display: "flex", gap: 10 }}>
          <div
            className="tnum"
            style={{
              width: 42,
              flex: "none",
              position: "relative",
              height: plotH,
            }}
          >
            {Array.from({ length: yTicks + 1 }, (_, i) => {
              const v = (nice / yTicks) * (yTicks - i);
              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    top: (plotH / yTicks) * i - 6,
                    right: 0,
                    fontSize: 10.5,
                    color: "var(--text-muted)",
                  }}
                >
                  {compact(v)}
                </div>
              );
            })}
          </div>

          <div style={{ flex: 1, minWidth: 0, position: "relative", height: plotH }}>
            {Array.from({ length: yTicks + 1 }, (_, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: (plotH / yTicks) * i,
                  height: 1,
                  background: i === yTicks ? "var(--axis)" : "var(--grid)",
                }}
              />
            ))}

            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "flex-end",
              }}
            >
              {buckets.map((b, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: "100%",
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "center",
                    position: "relative",
                    cursor: "default",
                    background:
                      hover === i ? "var(--ghost)" : "transparent",
                  }}
                  onMouseMove={(e) => {
                    setHover(i);
                    show(
                      e,
                      b.sublabel ? `${b.label} · ${b.sublabel}` : b.label,
                      [
                        ...series
                          .filter((s) => (b.parts[s.key] ?? 0) > 0)
                          .sort((x, y) => (b.parts[y.key] ?? 0) - (b.parts[x.key] ?? 0))
                          .map((s) => ({
                            label: s.label,
                            value: compact(b.parts[s.key] ?? 0),
                            color: s.color,
                          })),
                        { label: "Total", value: full(b.total) },
                      ],
                    );
                  }}
                  onMouseLeave={() => {
                    setHover(null);
                    hide();
                  }}
                >
                  <div
                    style={{
                      width: `min(${maxBarWidth}px, 74%)`,
                      height: `${(b.total / nice) * 100}%`,
                      display: "flex",
                      flexDirection: "column-reverse",
                      gap: 2,
                      justifyContent: "flex-start",
                    }}
                  >
                    {series.map((s, si) => {
                      const v = b.parts[s.key] ?? 0;
                      if (v <= 0) return null;
                      const isTop =
                        si ===
                        series.reduce(
                          (last, ss, idx) =>
                            (b.parts[ss.key] ?? 0) > 0 ? idx : last,
                          -1,
                        );
                      return (
                        <div
                          key={s.key}
                          style={{
                            flex: `${v / b.total} 1 0`,
                            background: s.color,
                            minHeight: 1.5,
                            borderRadius: isTop ? "4px 4px 2px 2px" : 2,
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* x axis band — sized as part of the container, never clipped */}
        <div style={{ display: "flex", gap: 10, marginTop: 7 }}>
          <div style={{ width: 42, flex: "none" }} />
          <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
            {buckets.map((b, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  minWidth: 0,
                  textAlign: "center",
                  fontSize: 10.5,
                  lineHeight: 1.35,
                  color:
                    b.highlight || hover === i
                      ? "var(--text-primary)"
                      : "var(--text-muted)",
                  fontWeight: b.highlight ? 600 : 400,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                }}
              >
                {i % labelStep === 0 || b.highlight ? b.label : ""}
                {b.sublabel && (i % labelStep === 0 || b.highlight) && (
                  <div style={{ fontSize: 9.5, opacity: 0.75 }}>{b.sublabel}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <Tooltip tip={tip} />
    </>
  );
}

const STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/**
 * Smallest round axis maximum that still clears the data. A coarse 1/2/5
 * ladder overshoots badly (an 8.9B peak lands on a 20B axis, wasting half
 * the plot), so the ladder is finer.
 */
function niceMax(max: number, ticks: number): number {
  const raw = max / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (STEPS.find((s) => norm <= s) ?? 10) * mag;
  return step * ticks;
}

/* ------------------------------------------------------------------ */
/* Stat tile                                                           */
/* ------------------------------------------------------------------ */

export function StatTile({
  label,
  value,
  sub,
  delta,
  accent,
  info,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: { pct: number; label: string } | null;
  accent?: string;
  info?: React.ReactNode;
}) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div
        style={{
          fontSize: 11.5,
          color: "var(--text-muted)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {accent && <i className="legend-swatch" style={{ background: accent }} />}
        {label}
        {info}
      </div>
      <div
        style={{
          fontSize: 27,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          marginTop: 5,
          lineHeight: 1.1,
          color: "var(--text-primary)",
        }}
      >
        {value}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          marginTop: 4,
          minHeight: 16,
        }}
      >
        {delta && Number.isFinite(delta.pct) && (
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: delta.pct > 0 ? "var(--critical)" : "var(--good)",
            }}
          >
            {delta.pct > 0 ? "▲" : "▼"} {Math.abs(delta.pct).toFixed(0)}%
          </span>
        )}
        {sub && (
          <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{sub}</span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Meter — one ratio against a limit                                   */
/* ------------------------------------------------------------------ */

export function Meter({ value, max = 100 }: { value: number; max?: number }) {
  const f = Math.max(0, Math.min(1, value / max));
  const color =
    f >= 0.9 ? "var(--critical)" : f >= 0.7 ? "var(--warning)" : "var(--series-1)";
  return (
    <div
      style={{
        height: 8,
        borderRadius: 4,
        background: "var(--seq-100)",
        overflow: "hidden",
      }}
      role="meter"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div style={{ width: `${f * 100}%`, height: "100%", background: color }} />
    </div>
  );
}
