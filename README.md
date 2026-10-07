# Herdr Bridge

A local, pixel-art operations map for agents running in herdr. It shows each agent as a unit with its workspace, current activity, state, and callsign. The bridge console has an optional beans work queue and standup/retro reader.

## Run

Requires Node.js 22+ and a working `herdr` command. Check `herdr agent list` first.

```sh
git clone https://github.com/andrebrov/herdr-viz.git
cd herdr-viz
node server.mjs
```

Open <http://127.0.0.1:4777>. No package install or build step is needed. The server binds to localhost and reads herdr through `herdr agent list` and `herdr workspace list`. It finds `herdr` on `PATH` or at `~/.local/bin/herdr`. Set `HERDR_BIN` if it lives elsewhere; set `PORT` to change the local port. Herdr's own environment variables, including its socket path, are inherited by the server.

Callsigns come from workspace labels such as `Sulu · claude-pm`. An optional tab-separated file at `~/.config/herdr/callsigns.tsv` can supply names when labels do not. Set `HERDR_CALLSIGNS_FILE` to use a different file.

## Optional feeds

The map works with herdr alone. To show beans and report history, point it at your own files:

```sh
BEANS_REPO=/path/to/your/project \
BEANS_TASKS_DIR=/path/to/seat-assignments \
BEANS_OWNERS_DIR=/path/to/bean-owners \
STANDUP_DIR=/path/to/standups \
RETRO_DIR=/path/to/retros \
node server.mjs
```

`BEANS_REPO` enables `beans list --json` in that directory. Seat assignments default to `~/.local/share/fleet-tasks` and owner files to `~/.local/share/fleet-watch/state/owner`; set the directory variables above if your layout differs. Each assignment file is named for a seat, and its second whitespace-separated field is the bean ID held by that seat. Each owner file is named for a bean and contains its owner seat. Set `BEANS_BIN` if `beans` is not on `PATH` or in `~/go/bin` or `~/.local/bin`.

The queue shows epic and milestone containers as group headers with their open-child counts and owner, then nests active child work beneath them. Containers never appear as unowned-unit alerts or unit cargo. Child counts use parent links in the read-only beans list.

`STANDUP_DIR` and `RETRO_DIR` are optional directories of Markdown files. Filenames start with `standup-` and `retro-` respectively; both may point to one shared directory. The page shows the 20 most recently modified files from each directory. All integrations are read-only. The server keeps its last good data when a command fails.

Click a unit or its callsign plate to inspect it. Scroll the lower inspector to read long titles. The right console has Queue, Today (completed beans updated today), Standup, and Retro tabs. Click a report to read it; press Escape or click × to close the reader.

Movement follows the reported agent state: working units carry their bean cargo between their outpost and the crystal field, then visit another working unit or the bridge; completed units gather at the bridge; idle units return home; blocked units stop where they are. These routes are a visual metaphor for work, not a claim that herdr reports physical movement or actual collaboration. The selected unit panel shows its current route and its real terminal title.

## Verify

```sh
node --check server.mjs
node verify-render.mjs
```

The render check covers 1440×900 at 2× pixel ratio and 1920×1080, label spacing, callsigns, state-based movement, the optional beans interface, inspector scrolling, and opening a standup report.

The HTTP endpoints are `/api/status`, `/api/beans`, and `/api/history`. They return JSON and are intended for local use. Do not put this server behind a public proxy without adding authentication: terminal titles and report text can contain private project information.
