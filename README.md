# pi-transcript-window

Keep only the latest **N** TUI chat messages visible in the [Pi coding agent](https://pi.dev)
terminal UI, while preserving the **full** session context underneath.

Fork of [pi-hide-messages](https://github.com/MasuRii/pi-hide-messages) by
[newCman1](https://github.com/newCman1), adapted for **pi 0.84+** (the upstream
patch targeted the removed `renderSessionContext` API; this fork patches
`renderSessionEntries` and filters hidden entries directly).

## Why

As a session grows, the TUI renders **every** entry — hundreds of tool calls,
each with output — and `ctrl+o` (expand tool output) rebuilds all of them,
making the UI slow. This extension hides older entries from the **display
layer only**: the session file (`~/.pi/agent/sessions/*.jsonl`) and the
model/agent context are never touched, so nothing is lost and compaction
behavior is unchanged.

## Features

- **Auto-hide on session start/switch** — keep only the latest N entries visible
- **Manual control** — `/hide-messages 20` keeps the latest 20; `/restore-messages` brings everything back
- **Branch-aware** — hiding follows the active session path (works across `/resume`, `/new`, `/fork`)
- **Display-only** — hidden entries are never deleted; the agent keeps full context
- **Configurable** — global and project-level `config.json`

## Install

```bash
pi install git:github.com/newCman1/pi-transcript-window
```

Or copy this folder into an auto-discovery location:

```text
~/.pi/agent/extensions/pi-transcript-window
# or project-local
.pi/extensions/pi-transcript-window
```

## Usage

| Command | Description |
|---|---|
| `/hide-messages` | Hide older entries, keeping the configured default count |
| `/hide-messages 20` | Hide older entries, keeping the latest 20 visible |
| `/restore-messages` | Restore all entries hidden by this extension |
| `/window` | Show the current ctrl+o expansion window |
| `/window 30` | ctrl+o expands only the latest 30 bash tool outputs |
| `/window off` | ctrl+o expands all tool outputs (no limit) |

`/window` is **independent** of message hiding: it only controls how many
recent **bash** tool outputs `ctrl+o` expands. Other tools (read/write/update)
render as one-line summaries with cc-style and are not counted. Messages stay
fully visible; only the expansion is limited to the newest N bash calls.
`/window off` restores pi's default behavior (expand everything).

## Configuration

Loaded from (project overrides global):

```text
~/.pi/agent/extensions/pi-transcript-window/config.json
.pi/extensions/pi-transcript-window/config.json
```

| Option | Type | Default | Description |
|---|---|---|---|
| `debug` | boolean | `false` | Reserved compatibility flag |
| `defaultVisibleCount` | number | `50` | Visible chat items to keep when hiding |
| `autoHideOnSessionStart` | boolean | `true` | Apply the limit on session start/switch |

```json
{
  "debug": false,
  "defaultVisibleCount": 50,
  "autoHideOnSessionStart": true
}
```

## How it works

- `/hide-messages` and `/restore-messages` record intent as append-only custom
  session entries (no historical JSONL rewriting).
- The extension patches `InteractiveMode.prototype.renderSessionEntries` (pi
  0.84+) to compute a hidden prefix over the active branch at render time and
  filter those entries before the original renderer runs.
- Old entries remain in the session file and in the agent context — only the
  TUI display omits them.

## Compatibility

- **pi 0.84+** (patches `renderSessionEntries`). Peer range is `^0.84.0`.
- Requires interactive (TUI) mode; degrades silently elsewhere.

## License

MIT — see [LICENSE](LICENSE). Upstream: [MasuRii/pi-hide-messages](https://github.com/MasuRii/pi-hide-messages).
