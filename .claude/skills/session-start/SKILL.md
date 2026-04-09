---
name: session-start
description: Lightweight solo session start for budget-tracker. Reads PROGRESS.md, verifies git state, runs scripts/dev-init.sh (if present), reports environment health. Use at the start of a solo session. If spawning parallel workers, use /start instead.
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Bash, Glob
argument-hint: [optional-focus-area]
---

# Solo Session Start

Lightweight init for a solo Claude Code session on budget-tracker. For the 3-Claude parallel workflow, use `/start` instead — this skill does NOT generate worker prompts.

If a focus area was provided: `$ARGUMENTS`

## Phase 1: Gather state (parallel)

Run these in parallel in a single tool-call message:

1. **Read** `PROGRESS.md` — what happened last session, what's next, any blockers
2. **Read** `CLAUDE.md` — session protocol + key constraints + what-not-to-do (re-read even if you've read it before; it evolves)
3. **Bash** `git log --oneline -10` — recent commits
4. **Bash** `git status` — working tree state
5. **Bash** `git worktree list` — check for stale worker worktrees that weren't cleaned up
6. **Bash** `bash scripts/dev-init.sh` — environment health. If the script doesn't exist yet (pre-Phase-0b), fall back to checking Docker compose stack state: `docker compose -f infra/docker-compose.dev.yml ps 2>/dev/null || echo "(no dev stack yet)"`

## Phase 2: Report

Produce a concise status report (< 20 lines). Structure:

- **Last session**: one-line summary from `PROGRESS.md`
- **Repo delta**: uncommitted changes, unexpected branch state, any stale worktrees
- **Environment**: Docker up/down, pnpm/Node available, tests passing count (if known)
- **Blockers**: anything from `PROGRESS.md` still unresolved
- **Focus**: today's top item — either from "Next Up" in `PROGRESS.md`, or from `$ARGUMENTS` if provided

## Rules

- Do NOT generate `PROMPT_INSTANCE_A.md` / `PROMPT_INSTANCE_B.md` — that's `/start`'s job
- Do NOT launch agents — this is a lightweight check
- If `dev-init.sh` fails, surface the failure clearly and stop — don't try to work around it
- If git status shows unexpected state (unstaged work on main, unfamiliar branches, orphan worktrees), flag it for user investigation before proceeding
- If `PROGRESS.md` references a phase or wave that doesn't match reality, flag the drift
