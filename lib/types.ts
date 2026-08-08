export type Source = "claude" | "codex";

/** Where the tokens were spent. This is the headline dimension. */
export type Lane = "main" | "auto-review" | "subagent" | "automation";

/** One aggregated bucket: a unique (day × dimensions) combination. */
export interface Row {
  day: string; // YYYY-MM-DD (local)
  src: Source;
  model: string;
  effort: string; // reasoning effort: low | medium | high | xhigh | max | ultra | none
  project: string;
  lane: Lane;
  agent: string; // subagent name, or ""
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  /** Real reasoning tokens. Codex reports these; Claude folds them into output. */
  reasoning: number;
  /** Characters of Claude thinking blocks — used to *estimate* its reasoning split. */
  thinkChars: number;
  turns: number;
}

/** Tool-call activity, the thing that actually drives context growth. */
export interface ToolRow {
  day: string;
  src: Source;
  lane: Lane;
  tool: string;
  calls: number;
}

export interface RateLimit {
  usedPercent: number;
  windowMinutes: number;
  resetsAt: number | null;
  plan: string | null;
  observedAt: number;
}

export interface ScanResult {
  rows: Row[];
  tools: ToolRow[];
  rateLimit: RateLimit | null;
  meta: {
    scannedAt: number;
    files: number;
    filesReparsed: number;
    bytes: number;
    durationMs: number;
    claudeDir: string;
    codexDir: string;
    missing: string[];
  };
}

export type TokenKind = "input" | "cacheWrite" | "cacheRead" | "output";

/* Runtime values live in ./agg so this module stays type-only. */
