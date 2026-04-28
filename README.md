# Interview Platform

A minimal localhost web app for technical interviews. Candidates edit code
in a browser-based Monaco editor and run the test suite with one click —
no local toolchain required on their machine.

```
┌─────────────────────────────────────────────────────────┐
│  Firmware Engineer Coding Task          [▶ Run] [■ Stop] │
├──────────────┬──────────────────────────────────────────┤
│  EDITABLE    │                                          │
│  parser.c  ◄─┤         Monaco Editor (vs-dark)          │
│  parser.h    │                                          │
│  test_parser │                                          │
│  ─────────── │                                          │
│  READ-ONLY   │                                          │
│  README.md   │                                          │
│  stage1...   │                                          │
├──────────────┴──────────────────────────────────────────┤
│  $ make run                                             │
│  [PASS] test_valid_temp_positive                        │
│  [FAIL] test_two_sequential_packets                     │
└─────────────────────────────────────────────────────────┘
```

---

## Prerequisites

- Node.js 18+
- The build tools required by the task (e.g. `gcc` + `make`) installed on the
  host, **or** the Docker sandbox image (see [Docker Sandboxing](#docker-sandboxing))

---

## Quick Start

```sh
# 1. Install dependencies (once)
cd interview-platform
npm install

# 2. Point at a task repo and start
TASK_DIR=/path/to/coding_task npm start

# 3. Open in browser
open http://localhost:3000
```

The server reads `task.json` from `TASK_DIR`, serves the specified files in
the editor, and runs the configured command when the candidate clicks **Run**.

---

## task.json Format

Each task repo needs a `task.json` at its root:

```json
{
  "name":     "Firmware Engineer Coding Task",
  "run":      "make run",
  "editable": [
    "parser.c",
    "parser.h",
    "test_parser.c"
  ],
  "show": [
    "README.md",
    "docs/stage1_overview.md",
    "docs/stage2_requirements.md"
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | No | Display name shown in the header |
| `run` | Yes | Shell command to execute on **Run** |
| `editable` | Yes | Files the candidate can edit and save |
| `show` | No | Additional files shown read-only (docs, etc.) |

`show` entries can be files or directories; directories are expanded
recursively. Files not listed in either field are not visible to the candidate.

---

## Resetting Between Candidates

The platform saves edits directly into `TASK_DIR`. To restore the starting
state for the next candidate:

```sh
cd /path/to/coding_task
git checkout -- .
```

---

## Docker Sandboxing

By default the `run` command executes directly on the host. For isolation,
build the sandbox image and prefix the `run` command with `docker run`:

```sh
# Build the sandbox image (once)
docker build -t interview-sandbox sandbox/

# Run with Docker isolation
TASK_DIR=/path/to/coding_task \
  DOCKER_SANDBOX=interview-sandbox \
  npm start
```

> **Note:** Docker sandboxing is not yet wired into the server. The
> `sandbox/Dockerfile` is provided as a starting point. To enable it,
> replace the `spawn('sh', ['-c', manifest.run], ...)` call in `server.js`
> with a `docker run --rm -v ${TASK_DIR}:/workspace interview-sandbox sh -c
> "${manifest.run}"` invocation.

---

## Architecture

```
interview-platform/
├── server.js          # Express + WebSocket server
├── public/
│   ├── index.html     # App shell
│   ├── app.js         # Monaco editor, file tabs, auto-save, WS client
│   └── style.css      # Dark-theme layout (CSS grid)
└── sandbox/
    └── Dockerfile     # gcc + make image for isolated runs
```

**Data flow:**
1. Browser loads → `GET /api/task` → files rendered as tabs in Monaco
2. Candidate edits → auto-saved after 1 s via `PUT /api/files/:path`
3. **Run** clicked → save flush → WebSocket `{type:"run"}` → server spawns
   `sh -c "<run command>"` in `TASK_DIR` → stdout/stderr streamed back →
   rendered in terminal pane
