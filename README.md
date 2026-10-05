# pi-compaction-toggle

![CI](https://github.com/keen99/pi-compaction-toggle/actions/workflows/ci.yml/badge.svg)
![release-watch](https://github.com/keen99/pi-compaction-toggle/actions/workflows/release-watch.yml/badge.svg)
[![pi tested](https://img.shields.io/github/v/release/keen99/pi-compaction-toggle?label=pi%20tested%200.75.0%20%E2%86%92)](https://github.com/keen99/pi-compaction-toggle/releases)

Live kill switch for pi auto-compaction. pi reads `compaction.enabled`
from settings.json only at startup — no built-in runtime toggle. This
extension blocks compaction via the `session_before_compact` hook,
toggleable without restarting pi. State persists across reloads and
restarts.

```
/compact-toggle          — show state
/compact-toggle on|off   — set explicitly (unknown args flip)
```

Note: the hook fires for manual /compact too (no discriminator), so
unblock before compacting manually.

## Install

```bash
# ssh
pi install git:git@github.com:keen99/pi-compaction-toggle

# https
pi install git:github.com/keen99/pi-compaction-toggle
```

## Development

`npm test` runs the unit suite (state roundtrip, corrupt-file
handling, full arg matrix); `npm run test:matrix` boots every stable
pi release (>= 0.75.0) in RPC mode with a pre-seed blocked state and
asserts via `COMPACTION_TOGGLE_DEBUG=1` that the extension loaded AND
honored the persisted state on the real process. Cached installs
live in `.matrix-cache/`.

Harness-driven fix: the state dir was resolved once at import from
homedir with no override, making the extension untestable and
ignoring `PI_CODING_AGENT_DIR`. State paths are now resolved per
call, and the `/compact-toggle` arg parsing is a pure exported
`nextBlocked()`.
