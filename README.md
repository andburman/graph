# Swimlanes

Agent-native persistent task graph. Not an issue tracker — a structured reasoning substrate for agents.

Agents create, decompose, execute, and replan work across sessions. Humans initiate work or supervise; agents do everything else.

## Why

Traditional issue trackers (Jira, Linear) are built around human constraints: columns, boards, discrete states, flat priority. When agents talk to them via MCP, they waste tokens on UI metadata and require 6+ round trips for simple workflows.

Swimlanes gives agents what they actually need:
- **Persistent task graph** — survives across sessions
- **Arbitrary nesting** — agents decompose as deep as needed
- **Explicit dependencies** — with cycle detection
- **Server-side ranking** — one call to get the next actionable task
- **~500 tokens** for a full claim-work-resolve cycle (vs ~5000+ with Linear MCP)

## Install

```bash
git clone https://github.com/andburman/swimlanes.git
cd swimlanes
npm install
npm run build
```

## Configure

Add to your Claude Code MCP config (`.mcp.json` in your project root):

```json
{
  "mcpServers": {
    "swimlanes": {
      "command": "node",
      "args": ["/path/to/swimlanes/dist/index.js"],
      "env": {
        "SWIMLANES_AGENT": "claude-code",
        "SWIMLANES_DB": "/path/to/swimlanes.db"
      }
    }
  }
}
```

Environment variables:
- `SWIMLANES_AGENT` — agent identity, attached to all writes (default: `default-agent`)
- `SWIMLANES_DB` — SQLite database path (default: `./swimlanes.db`)
- `SWIMLANES_CLAIM_TTL` — soft claim expiry in minutes (default: `60`)

## Tools

### swimlanes_open
Open or create a project. No args = list all projects.

### swimlanes_plan
Batch create nodes with parent-child and dependency relationships. Atomic.

### swimlanes_next
Get the next actionable node — unresolved leaf, all deps resolved, ranked by priority/depth/recency. Optional soft claim.

### swimlanes_context
Deep-read a node: ancestors, children tree, dependency graph.

### swimlanes_update
Update nodes: resolve, change state, add evidence/context links. Reports newly unblocked tasks.

### swimlanes_connect
Add or remove dependency and relationship edges. Cycle detection on depends_on.

### swimlanes_query
Search and filter nodes by state, properties, text, ancestry, actionability.

### swimlanes_restructure
Move, merge, or drop nodes. For replanning.

### swimlanes_history
Read the audit trail for a node.

## Design

- **`resolved` boolean** is the only field the engine interprets. Drives dependency computation. `state` is freeform for agent semantics.
- **Evidence model** — hints, notes, commits, test results are all evidence entries with a `type` field. One mechanism.
- **Linked context** — nodes store pointers to files/commits/docs, not content blobs.
- **Local-first** — SQLite, no cloud dependency, your data stays on your machine.

## License

MIT
