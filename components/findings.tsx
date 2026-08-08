"use client";

import React, { useState } from "react";
import {
  SEVERITY_COLOR,
  SEVERITY_LABEL,
  type Finding,
  type Severity,
} from "@/lib/anomalies";

/** Status colour never carries meaning alone — every badge has an icon + label. */
const ICON: Record<Severity, string> = {
  critical: "▲",
  warning: "▲",
  notice: "●",
};

export function Findings({
  findings,
  hasData,
}: {
  findings: Finding[];
  hasData: boolean;
}) {
  const [open, setOpen] = useState<string | null>(findings[0]?.id ?? null);

  if (!hasData) {
    return (
      <div className="card" style={{ marginBottom: 14 }}>
        <h2 className="card-title">No usage in this window</h2>
        <p className="card-sub">
          Nothing matched the current filters, so there is nothing to check.
          Widen the date range or clear a filter.
        </p>
      </div>
    );
  }

  if (!findings.length) {
    return (
      <div className="card" style={{ marginBottom: 14 }}>
        <h2
          className="card-title"
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          <span style={{ color: "var(--good)" }} aria-hidden>
            ●
          </span>
          Nothing unusual in this window
        </h2>
        <p className="card-sub">
          No runaway days, no single setting dominating, and nothing obviously
          burning tokens in the background. Widen the range or clear the filters
          to check a longer period.
        </p>
      </div>
    );
  }

  const counts = findings.reduce<Record<string, number>>((a, f) => {
    a[f.severity] = (a[f.severity] ?? 0) + 1;
    return a;
  }, {});

  return (
    <section
      className="card"
      style={{
        marginBottom: 14,
        borderColor:
          findings[0].severity === "critical"
            ? "var(--critical)"
            : "var(--border)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 4,
        }}
      >
        <h2 className="card-title">What's quietly burning tokens</h2>
        <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
          {(["critical", "warning", "notice"] as Severity[])
            .filter((s) => counts[s])
            .map((s) => `${counts[s]} ${SEVERITY_LABEL[s].toLowerCase()}`)
            .join(" · ")}
        </span>
      </div>
      <p className="card-sub" style={{ marginBottom: 14 }}>
        Automatic checks over the window you selected. Each one explains why it
        matters and what to do — click to expand.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {findings.map((f) => {
          const isOpen = open === f.id;
          return (
            <div
              key={f.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 11,
                overflow: "hidden",
                background: "var(--ghost)",
              }}
            >
              <button
                onClick={() => setOpen(isOpen ? null : f.id)}
                aria-expanded={isOpen}
                style={{
                  width: "100%",
                  appearance: "none",
                  background: "transparent",
                  border: 0,
                  font: "inherit",
                  textAlign: "left",
                  padding: "11px 13px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  color: "var(--text-primary)",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    flex: "none",
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: SEVERITY_COLOR[f.severity],
                    textTransform: "uppercase",
                    letterSpacing: "0.03em",
                    minWidth: 96,
                    paddingTop: 2,
                  }}
                >
                  <span aria-hidden>{ICON[f.severity]}</span>
                  {SEVERITY_LABEL[f.severity]}
                </span>

                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{ fontSize: 13, fontWeight: 600, display: "block" }}
                  >
                    {f.title}
                  </span>
                  {f.share !== undefined && (
                    <span
                      style={{
                        display: "block",
                        height: 3,
                        borderRadius: 2,
                        marginTop: 7,
                        background: "var(--grid)",
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          height: "100%",
                          borderRadius: 2,
                          width: `${Math.max(2, Math.min(100, f.share * 100))}%`,
                          background: SEVERITY_COLOR[f.severity],
                        }}
                      />
                    </span>
                  )}
                </span>

                <span
                  aria-hidden
                  style={{
                    flex: "none",
                    color: "var(--text-muted)",
                    fontSize: 11,
                    transform: isOpen ? "rotate(90deg)" : "none",
                    transition: "transform .15s",
                    paddingTop: 2,
                  }}
                >
                  ›
                </span>
              </button>

              {isOpen && (
                <div
                  style={{
                    padding: "0 13px 13px 119px",
                    fontSize: 12.5,
                    lineHeight: 1.55,
                    color: "var(--text-secondary)",
                  }}
                >
                  <p style={{ margin: "0 0 9px" }}>{f.detail}</p>
                  <p style={{ margin: "0 0 9px" }}>
                    <strong style={{ color: "var(--text-primary)" }}>
                      Why it matters:
                    </strong>{" "}
                    {f.why}
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong style={{ color: "var(--text-primary)" }}>
                      What to do:
                    </strong>{" "}
                    {f.action}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
