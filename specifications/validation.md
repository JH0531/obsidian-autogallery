# Validation Workflow

How to verify a change in a real Vault: launching the app, the CLI exit-code
trap, reload caveats, the DOM and geometry assertions, and the PDF export
validation steps.

Read this before running a manual verification pass, when a CLI call looks
successful but returns nothing, or when a reload appears to succeed while the old
code still runs.

## Launching the app

The app must be running before any CLI command or DevTools call, and the debug
port only exists if it was passed on the command line:

```powershell
Start-Process -FilePath "C:\Program Files\Obsidian\Obsidian.exe" `
  -ArgumentList '--remote-debugging-port=9333'
```

Two behaviours decide how the rest of this file is written:

1. **The process lives only as long as its launcher.** An app started inside a
   script or tool call is reaped when that call returns. Launch it and use it in
   the same call; a run that is alive and responsive at second 120 will still be
   gone once the call ends. To keep it alive for an interactive session, host it
   in a long-running background task instead.
2. **The flag cannot be added to a running instance.** Starting the executable
   again while another copy owns the vault only focuses that window and exits, so
   an app launched without `--remote-debugging-port` stays without it. Fully quit
   it first (`taskkill /IM Obsidian.exe /F`), then relaunch with the flag.

`--remote-debugging-port` is supported on 1.14.5. Do not downgrade to get it, and
do not read "the app is gone" as "the flag crashed it" — check the launcher's
lifetime first.

## Talking to a running app

### The CLI

```powershell
obsidian vault=test eval code="1+1"      # => 2 marks a live, reachable app
obsidian vault=test plugin:reload id=obsidian-autogallery
obsidian vault=demo open path="03-分组规则.md"
```

**The CLI exits 0 even when it fails.** All three failure messages below come
with a success exit code, so a caller that only inspects `$?` treats them as
data and goes on to parse an empty string:

| Output | Meaning |
| --- | --- |
| `The CLI is unable to find Obsidian. Please make sure Obsidian is running and try again.` | No app, or no CLI channel (the app was launched headless or has quit) |
| `Vault not found.` | The `vault=` name does not match an entry in `%APPDATA%\obsidian\obsidian.json` |
| `Error: Command "<x>" not found.` | Wrong verb; `help` lists the supported set |

Match the text, not the exit code. A wrapper that turns these into a non-zero
status is worth writing the first time a script silently consumes one of them.

An empty result is not proof that the vault holds nothing: check
`tasklist | findstr Obsidian` before debugging the query.

### The DevTools port

Use the port when the result must come back verbatim, or when the CLI's command
set does not cover the operation (arbitrary JS, DOM measurement, page-side
capture):

```js
// GET http://127.0.0.1:9333/json/list , pick the target with type "page"
// Runtime.evaluate { expression, awaitPromise: true, returnByValue: true }
```

Two environment traps:

- **Proxies intercept loopback.** With `HTTP_PROXY` set, a plain `fetch` to
  `127.0.0.1:9333` fails with `ECONNREFUSED`, which looks exactly like "Obsidian
  is not running". Use `node:http` and set `NO_PROXY=127.0.0.1,localhost`.
- **A stale target list means a stale instance.** If `/json/list` answers but the
  page is unresponsive, the previous run's renderer is still shutting down; quit
  the app and relaunch rather than retrying against it.

Page-side capture needs a visible window: a minimised or backgrounded window has
`document.hidden === true`, and screenshots come back blank while `eval`, computed
styles and geometry still work.

### Confirming the loaded build

`plugin:reload` is not a guarantee. A previous build whose promise is still
pending (a native save dialog that was never answered is the usual cause) keeps
its module in memory, and the reload reports success while the old code keeps
running. Always confirm the loaded build before trusting a test — check for a
symbol that only the new build exports, e.g.
`obsidian vault=test eval code="typeof app.plugins.plugins['obsidian-autogallery'].savePdfPrefs"` —
and use `obsidian vault=test restart` when it still reports the old shape.
`dev:dom` and `dev:screenshot` can return nothing while the window is minimised
(`document.hidden === true`); `eval` still works there, so assert on computed
geometry, cell widths and `getComputedStyle` values instead of on pixels.

## PDF/Obsidian CLI notes

- Obsidian's native PDF export applies its own `orphans`/`widows` handling. A
  plugin orphan pass must use `orphans: 1` and `widows: 1` while it measures
  the document, otherwise Chromium moves the previous line before the plugin
  can compress the preceding page.
- A PDF image unit is the complete rendered block, including its span/embed,
  generated caption and any widget wrapper. Gallery rows never split and must
  never be used as donors, but a row may still be the fit target: it shrinks as
  one unit, inside fixed column slots. Orphan repair must not include a gallery
  row among its compression candidates.
- Validate PDF changes in the real test Vault with `obsidian vault=test
  plugin:reload id=obsidian-autogallery`, `obsidian vault=test open
  file="..."`, and the registered `workspace:export-pdf` command. Do not add
  Vitest/jsdom fixtures or maintain a second implementation for tests.
- The native export save picker can remain open while Chromium prepares the
  print document. Keep the plugin's temporary styles alive until `afterprint`
  or the bounded cleanup timer; never replace the native save flow or force
  focus to the picker during CLI verification.
