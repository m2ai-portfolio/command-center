# BLUEPRINT — CMD Live Artifact Frontend via MCP

**Created:** 2026-04-23
**Status:** Phase 0 complete, Phase 1 planned
**Goal:** Replace CMD's Vite/React dashboard with a Claude Cowork Live Artifact that drives CMD through a single MCP server.

---

## Context

CMD today runs a Vite/React SPA at `http://10.0.0.46:3142/` backed by the same `command-center` Node process that hosts the mission runtime, scheduler, worker pool, and HTTP API. The dashboard is a tightly coupled frontend; the backend is the actual product.

Matthew is killing the Vite frontend and replacing it with a Live Artifact rendered inside Claude Cowork. A Live Artifact is an interactive HTML/JS surface that runs in Cowork's iframe and calls `window.cowork.callMcpTool` to invoke tools on remote MCP servers.

**Key constraint confirmed in Phase 0:** Cowork runs in Anthropic's cloud. MCP endpoints must be reachable from the public internet — LAN-only endpoints are not an option for the Live Artifact path. This forces a tunnel + auth layer. Choosing Cloudflare Tunnel + Cloudflare Access.

**Architectural decision:** CMD MCP is the **single API** the Live Artifact talks to. Cowork exposes its own `scheduled-tasks` MCP, but CMD's scheduler must run regardless of whether any Cowork session is active — scheduler lives inside the pm2 `command-center` process and fires missions autonomously. Using Cowork-native scheduling would create a split-brain scheduler and couple CMD's reliability to Cowork session state. The CMD MCP surface therefore mirrors CMD's HTTP API for everything the Live Artifact needs.

---

## Phase 0 findings (validated 2026-04-23)

All critical unknowns resolved during smoke test in `~/projects/cmd-mcp-poc/`:

| Unknown | Outcome |
|---|---|
| Cowork registers trycloudflare remote MCP URL | Works |
| Live Artifact invokes MCP tools from iframe | Works via `window.cowork.callMcpTool` |
| Refresh semantics | Artifact controls its own cadence with `setInterval`; each call goes through `callMcpTool` |
| Client-side caching | Present, keyed on `(tool, args)`, empirically verified with 60s polling test |
| Cache-bust mechanism | Pass a varying arg (e.g. `_nonce: Date.now()`); confirmed working with two arrivals 59s apart |
| Extra-key tolerance | Permissive JSON Schema passes unknown keys through without error |
| QUIC on ProBook network | Blocked / flapping; use `cloudflared --protocol http2` instead |
| Tunnel latency | ~130ms through the Atlanta CF edge |

**Reusable decisions for Phase 1:**
- Every tool accepts an ignored `_nonce?: number` parameter. Artifact passes `Date.now()` on every refreshable call.
- HTTP/2 transport, not QUIC. Named tunnels must be configured explicitly.
- Tool namespace in Cowork: `mcp__<hash>__<tool>`. Artifact code references the full prefixed name.

---

## Scope — in and out

**In scope for Phase 1:**
- Convert `command-center/mcp/index.ts` from stdio to streamable HTTP transport
- Expand tool surface from current 7 tools to ~20 covering all Live Artifact use cases
- Bearer token auth at the MCP layer
- Build/start scripts, pm2 integration
- Local verification (no public exposure yet)

**Out of scope for Phase 1 (moved to Phase 2 and 3):**
- Public exposure via Cloudflare Tunnel — Phase 2
- Cloudflare Access OAuth gate — Phase 2
- systemd/pm2 production configuration — Phase 2
- Actual Live Artifact build — Phase 3
- Cutover from Vite UI — Phase 4
- 14-day adoption gate — Phase 5

**Explicitly not building:**
- A new UI framework, component library, or auth service. The Live Artifact is plain HTML/JS. The MCP is plain tool routing. No abstractions.
- Write endpoints beyond what the Live Artifact needs. CRUD on `custom-agents` and `triggers` is deferred to Phase 3 unless the artifact requires them.

---

## Architecture

```
┌──────────────┐       ┌──────────────────┐       ┌─────────────┐
│   Surface    │       │  Anthropic cloud │       │   ProBook   │
│  (browser)   │       │                  │       │             │
│              │       │  ┌────────────┐  │       │  ┌────────┐ │
│ Cowork UI    │◀──────┼──│  Cowork    │  │       │  │ CMD    │ │
│ Live Artifact│       │  │  session   │──┼───▶───┼──│ MCP    │ │
│   iframe     │       │  │  + MCP     │  │ HTTPS │  │ server │ │
│              │       │  │  client    │  │       │  │ :3150  │ │
└──────▲───────┘       │  └────────────┘  │       │  └───┬────┘ │
       │               │                  │       │      │      │
       │ calls         └──────────────────┘       │      │HTTP  │
       │ callMcpTool                              │      │      │
       │ (client-side)                            │  ┌───▼────┐ │
       │                                          │  │ CMD    │ │
       └────────────── direct call ───────────────┼──│ :3142  │ │
                       to MCP                     │  │ HTTP   │ │
                                                  │  │ API    │ │
                                                  │  └────────┘ │
                                                  └─────────────┘
```

**Data flow (read path — dashboard render):**
1. Live Artifact in Cowork iframe calls `window.cowork.callMcpTool('mcp__<hash>__list_missions', { status: 'running', _nonce: Date.now() })`
2. Cowork's MCP client forwards the JSON-RPC call to `https://<cf-tunnel>/mcp` (Phase 2) or `http://127.0.0.1:3150/mcp` (Phase 1 local)
3. CMD MCP receives the call, drops `_nonce`, translates to `GET http://127.0.0.1:3142/api/missions?status=running`
4. CMD HTTP API returns mission list
5. CMD MCP wraps response in JSON-RPC text content, streams back through Cowork
6. Artifact renders

**Data flow (write path — approve mission):**
Same shape, but MCP tool calls `POST /api/missions/:id/approve`. Writes are not cached on the Cowork side because each call has unique args.

---

## Tool surface — Phase 1

Curated from `server/routes.ts`. Every tool accepts `_nonce?: number` (ignored server-side) to let the Live Artifact bypass client-side cache.

**Missions (5 tools)**
| Tool | HTTP | Purpose |
|---|---|---|
| `cmd_list_missions` | `GET /api/missions` | Queue view — filter by status, limit |
| `cmd_get_mission` | `GET /api/missions/:id` | Detail view — logs + judge history |
| `cmd_create_mission` | `POST /api/missions` | User creates mission from artifact form |
| `cmd_approve_mission` | `POST /api/missions/:id/approve` | HIL gate — human clicks approve |
| `cmd_cancel_mission` | `POST /api/missions/:id/cancel` | Stop a running mission |

**Agents (2 tools)**
| Tool | HTTP | Purpose |
|---|---|---|
| `cmd_list_agents` | `GET /api/agents` | Roster with status/tier/skills |
| `cmd_get_agent_capabilities` | `GET /api/agents/:id/capabilities` | Single agent detail |

**Schedules (4 tools)**
| Tool | HTTP | Purpose |
|---|---|---|
| `cmd_list_schedules` | `GET /api/schedules` | Schedule list with next-run times |
| `cmd_create_schedule` | `POST /api/schedules` | New recurring mission |
| `cmd_run_schedule_now` | `POST /api/schedules/:id/run` | Manual fire |
| `cmd_delete_schedule` | `DELETE /api/schedules/:id` | Remove |

**Tasks / A2A dispatch (3 tools)**
| Tool | HTTP | Purpose |
|---|---|---|
| `cmd_list_tasks` | `GET /api/tasks` | Fire-and-forget task queue |
| `cmd_create_task` | `POST /api/tasks` | Dispatch to Named agent |
| `cmd_get_task` | `GET /api/tasks/:id` | Single task detail |

**Observability (4 tools)**
| Tool | HTTP | Purpose |
|---|---|---|
| `cmd_get_status` | `GET /api/status` | System health |
| `cmd_get_stats` | `GET /api/stats` | Aggregate counters |
| `cmd_get_workers` | `GET /api/workers` | Worker pool state |
| `cmd_get_hivemind` | `GET /api/hivemind` | Cross-agent activity log |

**Triggers (2 tools)**
| Tool | HTTP | Purpose |
|---|---|---|
| `cmd_list_triggers` | `GET /api/triggers` | Active triggers |
| `cmd_get_trigger_fires` | `GET /api/triggers/:id/fires` | Fire history |

**Insights (2 tools)**
| Tool | HTTP | Purpose |
|---|---|---|
| `cmd_get_ideaforge` | `GET /api/st-metro/ideaforge` | ST Metro IdeaForge signals |
| `cmd_get_sky_lynx_recs` | `GET /api/sky-lynx/recs` | Sky-Lynx recommendations |

**Total: 22 tools.**

**Deferred to Phase 3 if/when the artifact needs them:**
- Trigger CRUD (`POST/PATCH/DELETE /api/triggers/*`)
- Custom agent CRUD (`POST/PUT/DELETE /api/custom-agents/*`)
- Stock agent sync (`POST /api/stock-agents/sync`, `POST /api/stock-agents/load`)
- `/api/chat` endpoint — not dashboard-relevant, adds surface area for no gain

---

## Design conventions

**Authentication.** Single bearer token via `Authorization: Bearer <token>` header. Stored in `~/.env.shared` as `CMD_MCP_BEARER_TOKEN`. Token generated with `openssl rand -hex 32`. MCP server rejects requests without a valid token with 401. Live Artifact includes the token via Cowork's remote MCP config (Cowork-UI-level, not baked into artifact code).

**Error shape.** All tool errors return a structured content block:
```json
{ "content": [{ "type": "text", "text": "{\"error\": \"...\", \"status\": 404}" }], "isError": true }
```
Never surface raw CMD API responses on failure — wrap them.

**Schema conventions.**
- Required args on first position
- Optional filters after
- Final `_nonce?: number` on every tool, even write tools, to keep the artifact's `callMcpTool` signature uniform
- Zod schemas for runtime validation, even though the MCP SDK handles basic type checking

**Logging.** Structured JSON log per request to stdout. Fields: `ts`, `tool`, `duration_ms`, `status`, `error` (if any). CMD pm2 already captures stdout, so no new log plumbing needed.

**Rate limiting.** Out of scope for Phase 1. The bearer token is the only thing between attackers and CMD's API once the tunnel is public. Phase 2 adds Cloudflare Access on top (OAuth gate); that covers the real abuse surface. If per-tool rate limits become necessary, add in Phase 3.

**No DB access from the MCP.** The MCP is a thin proxy over `http://127.0.0.1:3142`. All logic stays in `server/routes.ts` / `server/db.ts`. Matches the pattern already established by the existing stdio MCP shim.

---

## Work breakdown

**P1.1 — Add streamable HTTP transport to MCP** (~1.5h)
- Install no new deps (SDK 1.29 already has it)
- Refactor `mcp/index.ts` to mount a Node http server on `:3150` (same port as POC for continuity)
- Per-request transport creation, stateless mode (proven in POC)
- Keep stdio path available via `--transport stdio` CLI arg for Claude Desktop / Claude Code CLI use cases
- Health endpoint at `GET /health` (already proven in POC)

**P1.2 — Expand tool surface** (~3h)
- Port the 22 tools listed above
- Consistent naming: `cmd_<verb>_<noun>` (matches existing convention in `mcp/index.ts`)
- Each tool: zod schema with `_nonce` added, thin cmdFetch wrapper, structured response
- Tool descriptions written for agent discoverability (Live Artifact won't read them, but other MCP clients might)

**P1.3 — Bearer token auth** (~0.5h)
- Middleware in the Node http handler: check `Authorization: Bearer <token>` against `process.env.CMD_MCP_BEARER_TOKEN`
- 401 on missing/wrong token, 200 on match, bypass for `/health`
- Generate token, add to `~/.env.shared`, add loading pattern to MCP startup

**P1.4 — Build + pm2 integration** (~0.5h)
- Update `tsconfig.server.json` to include new MCP paths if needed
- Add MCP to `ecosystem.config.cjs` as a separate pm2 app named `cmd-mcp` on port 3150
- Confirm `npm run build` produces `dist/server/mcp/index.js`
- `pm2 reload ecosystem.config.cjs` as part of rollout

**P1.5 — Local verification** (~1h)
- Swap the POC tunnel in Cowork to point at the real CMD MCP URL (still through the same trycloudflare URL for continuity — tunnel just reassigns to port 3150 target)
- Run each of the 22 tools from a Cowork session chat
- Verify shape of every response, that filters work, that writes persist
- Document any shape bugs or missing endpoints in a P1.6 follow-up task

**Total estimated: 6–7 hours of focused work.**

---

## Acceptance criteria for Phase 1

- [ ] `npm run build` succeeds in `command-center/`
- [ ] `pm2 start ecosystem.config.cjs` starts both `command-center` (existing) and `cmd-mcp` (new)
- [ ] `curl http://127.0.0.1:3150/health` returns 200
- [ ] `curl -X POST http://127.0.0.1:3150/mcp` without auth returns 401
- [ ] `curl -X POST http://127.0.0.1:3150/mcp` with correct Bearer token returns JSON-RPC initialize response
- [ ] All 22 tools appear in `tools/list` response
- [ ] Each tool successfully proxies to the corresponding CMD route when invoked from a Cowork session
- [ ] Existing stdio MCP usage (Claude Desktop / Claude Code CLI) still works via `--transport stdio` flag
- [ ] `BLUEPRINT.md` status flipped to "Phase 1 complete, Phase 2 ready"

---

## Open questions for Phase 2+

Capture now so they're not lost. Resolve at the start of Phase 2.

1. **Permanent hostname.** Two options:
   - (a) Buy a short domain (`$10/yr`) just for CMD infra, e.g. `cmd-api.<something>.com`
   - (b) Subdomain on `memyselfplusai.com` (already owned, actively in rebrand). Something like `mcp.memyselfplusai.com` or `cmd.memyselfplusai.com`.
   - Leaning toward (b) to avoid account proliferation. Needs verification that memyselfplusai.com's DNS is on Cloudflare or can be moved there.

2. **Cloudflare Access policy granularity.** Single identity (`matthew.snow2@gmail.com`) for Phase 2. Question: does Cowork's remote MCP client forward CF Access session cookies on subsequent calls, or do we need an API-token bypass for service calls? Empirical test required at Phase 2 start.

3. **Tunnel supervision.** `cloudflared` quick-tunnel is one binary. Production named tunnel: install `cloudflared service install` (systemd unit) vs. pm2-managed process. Leaning systemd because CF docs document that path.

4. **Token rotation.** Bearer token has no rotation story today. Acceptable for Phase 1 (single token, manual rotation). At Phase 2/3, revisit if adoption grows and we want per-client tokens.

5. **Cowork MCP auth flow for bearer tokens.** How does Cowork's remote MCP config accept custom Authorization headers? Research needed at Phase 2 — may inform whether we stick with bearer token or switch to OAuth/mTLS.

6. **Overlap with Cowork-native MCPs (flagged by Matthew 2026-04-23).** Cowork ships `scheduled-tasks`, `session_info`, `skills`, `plugins`, `mcp-registry`, `cowork` (artifact CRUD), `perceptor` as first-class. Decision already made: CMD MCP remains the single API for Live Artifact use. But worth an explicit "don't duplicate" note: if a CMD operation has a Cowork-native equivalent that is *better* (e.g. artifact CRUD is always better from Cowork's own tool than from CMD's MCP), use the native one from the Live Artifact directly. CMD MCP owns *CMD's* state; Cowork MCPs own *Cowork's* state. No cross-ownership.

---

## Phase 2 preview (carryover)

- Named Cloudflare Tunnel on permanent hostname
- Cloudflare Access: single Google OAuth identity
- systemd or pm2 supervision for `cloudflared`
- Cold-start verification: reboot ProBook, confirm tunnel + MCP come up clean
- Update Live Artifact / Cowork MCP registration to point at permanent URL
- Retire the trycloudflare URL from Cowork

## Phase 3 preview

- Design and build the actual Live Artifact
- Inventory what the Vite UI shows; map to MCP tools
- Implement dashboard panels one-at-a-time, verify refresh behavior
- Document `_nonce` convention as a note in artifact code for future maintainers

## Phase 4 preview

- Run Live Artifact + Vite UI in parallel for ~1 week
- Feature-parity check
- Disable Vite client build (keep `command-center` server, just drop the `/` static route)
- Remove `src/` (Vite client) code after confirmed stable

## Phase 5 — 14-day adoption gate

- New `cmd-mcp` MCP is experimental until **2026-05-07**
- Sponsor path: Matthew invocations ≥3 in window, OR CMD agent manifest lists it, OR active callsite (grep-able)
- If no sponsor by day 14, delete

---

## Session state at pause (2026-04-23 break)

- Phase 0 POC at `~/projects/cmd-mcp-poc/` — running
- MCP POC server on `:3150` — up, logging to `/tmp/cmd-mcp-poc.log`
- Cloudflared HTTP/2 tunnel — up at `https://traditional-wanting-every-placing.trycloudflare.com`
- Cowork Live Artifact — registered, rendering, 60s polling working, cache-bust verified
- Next action on resume: start P1.1 — add streamable HTTP transport to `command-center/mcp/index.ts` alongside the existing stdio one
