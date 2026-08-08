# Token Atlas

**Find where Claude Code and Codex are burning your tokens without you noticing.**

Most token spend is invisible. Background agents, automatic code review and
runaway sessions never scroll past you — they just quietly eat your weekly
allowance. Token Atlas reads the session logs already on your disk and shows
you exactly where it went.

## Install — about 2 minutes, no technical knowledge needed

Never used a terminal? That's fine. Follow the steps for your computer.

### On a Mac

**1. Open Terminal.** Hold `⌘` and press the space bar, type `terminal`, press
Enter. A plain window with text in it opens. That's Terminal.

**2. Copy the line below**, click into the Terminal window, paste it with
`⌘V`, and press Enter:

```sh
curl -fsSL https://graemevip.github.io/token-atlas/i.sh | sh
```

**3. Wait** a few seconds while it downloads.

**4. Type this and press Enter:**

```sh
token-atlas
```

Your browser opens by itself. First time it takes ~30 seconds to read your
logs; after that it's instant.

### On Windows

**1. Open PowerShell.** Press the Windows key, type `powershell`, press Enter.
A blue window opens.

**2. Copy the line below**, right-click inside the blue window to paste it,
then press Enter:

```powershell
irm https://graemevip.github.io/token-atlas/w.txt | iex
```

That's it — it installs and starts on its own, and your browser opens. Next
time, just type `token-atlas`.

### When you're finished

Click back on the terminal window and press `Ctrl + C` to stop it.

---

**No Node, no npm, nothing else to install.** It's a single self-contained
program. If you'd rather not run a command you can't read, the script is right
here: [install.sh](install.sh) / [install.ps1](install.ps1). The short
`i.sh` / `w.txt` links are one-line bootstraps that fetch those.

> Everything runs locally. Your logs are never uploaded, and the app makes no
> network calls with your data. There is no account and no API key.

<details>
<summary>Other ways to install</summary>

**Already have Node 20+?**

```bash
npx token-atlas
```

**Prefer to download by hand?** Grab the binary for your machine from
[Releases](https://github.com/graemevip/token-atlas/releases), make it
executable (`chmod +x`) and run it.

| Platform | File |
| --- | --- |
| macOS (Apple Silicon) | `token-atlas-macos-arm64` |
| macOS (Intel) | `token-atlas-macos-intel` |
| Windows | `token-atlas-windows.exe` |
| Linux (x64 / arm64) | `token-atlas-linux-x64` / `token-atlas-linux-arm64` |

Note: binaries downloaded through a *browser* get flagged by macOS Gatekeeper
and Windows SmartScreen because they aren't code-signed. The install commands
above avoid that, which is why they're the recommended route.

</details>

---

## What it found on one real account

- **51%** of all tokens went to subagents the user never saw
- One combination — `gpt-5.6-sol` at `max` effort, spawned as a helper —
  was **35% of everything**, across 45,992 requests
- A single day burned **8.8B tokens: 70× a typical day**
- Auto review, widely blamed online, was **4.7%**

That last one is the point. Everyone's mix is different, and the only way to
know yours is to measure it.

## What you get

- **Automatic findings** — nine checks over the window you pick, each
  explaining why it matters and what to do. Runaway days use a median absolute
  deviation, not a standard deviation, because one huge spike inflates the mean
  and hides the very outlier you're hunting.
- **Lanes** — every request attributed to who spent it: you, a subagent,
  automatic review, or scheduled automation.
- **Full granularity** — model, reasoning effort, project, subagent, tool.
- **Raw vs weighted** — raw counts every token equally; weighted applies each
  kind's relative cost, so ranking reflects expense rather than volume.
- **Saturday-start weeks**, because not everyone's week begins on Monday.
- Light and dark, keyboard accessible, and a plain-English guide built in.

## Options

```bash
npx token-atlas --port 4319   # pick a port (default 4319, or next free)
npx token-atlas --no-open     # don't open a browser
npx token-atlas --help
```

| Environment variable | Use |
| --- | --- |
| `TOKEN_ATLAS_CLAUDE_DIR` | point at Claude Code logs explicitly |
| `TOKEN_ATLAS_CODEX_DIR` | point at Codex logs explicitly |

By default it looks in `~/.claude/projects` and `~/.codex/sessions`, honouring
`CLAUDE_CONFIG_DIR` and `CODEX_HOME`, and falling back to `%APPDATA%` on
Windows. Having only one of the two tools is fine — the other shows as empty.

Cache lives in `~/.token-atlas/`. Delete it to force a clean rescan.

## Two parsing details that decide every number

Both were verified against raw logs. Getting either wrong silently changes
everything the app reports.

**Claude Code repeats usage across lines.** One API response is written as
several JSONL lines — one per content block — each carrying an *identical*
`usage` object. Summing naively inflates totals ~2.4× (22,530 lines are really
9,423 requests). Usage is counted once per `requestId`; content blocks are
disjoint across those lines, so tool calls and thinking are read from every one.

**Codex's counter is cumulative.** `total_token_usage` is a running total, so
per-turn cost is the delta between consecutive events, attributed to the model
from the most recent `turn_context`. Summing `last_token_usage` double-counts,
because duplicate events are emitted. Counter resets inside a file are detected.
Codex's `input_tokens` is inclusive of the cached portion, so fresh input is
`input − cached`.

## Development

```bash
git clone https://github.com/graemevip/token-atlas && cd token-atlas
npm install
npm run dev          # http://localhost:3000

npm run verify       # cold scan + totals by source, lane, model, effort
npm run findings     # the anomaly checks, in the terminal
npm run test:week    # asserts Saturday-start week bucketing over 400 days
```

### Building releases

Two shapes ship from one codebase:

```bash
npm run build        # Node/npx package (.next/standalone, keeps the API route)
npm run build:binary # single binaries for all 5 platforms -> dist/
```

The binary build exports the UI statically, inlines it into `server/assets.ts`
as base64, and cross-compiles with `deno compile`. The dashboard is entirely
client-side, so a ~120-line Deno server replaces Next at runtime and the result
needs no runtime installed at all. `deno compile` requires
`--node-modules-dir=none`, or it bakes the whole 357 MB `node_modules` into
every binary (429 MB → 70 MB).

Upload everything in `dist/` to a GitHub release; the install scripts pull from
`releases/latest`.

## Privacy

Reads `*.jsonl` session logs, extracts only token counts and metadata (model,
effort, timestamps, tool names, working-directory basename), and keeps the
aggregate in a local cache. Prompts, code and file contents are never parsed
into the output.

One thing to know before you post a screenshot: the **Projects** table shows
folder names from your working directories. Use the project filter or crop it
if those are sensitive.

## Licence

MIT
