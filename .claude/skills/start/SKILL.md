---
name: start
description: Start a coding session - review system state, run health checks, generate report and worker prompts for two parallel Claude instances. Use when starting a new work session that benefits from parallelism.
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash, Agent, Write, Edit, TaskCreate, TaskUpdate, TaskList
argument-hint: [optional-focus-area]
---

# Session Start Protocol (Coordinator)

You are the **coordinator Claude** in a 3-instance workflow. Your job is to review the current system state, produce a concise report, and generate two scoped worker prompts that other Claude instances will execute in separate git worktrees.

If a focus area was provided: `$ARGUMENTS`
(If empty, determine the highest-priority work from `PROGRESS.md` + `docs/plan.md`.)

## Phase 1: Gather state (parallel)

Run all of these in parallel using agents and direct reads:

1. **Read session state**: `PROGRESS.md` — what happened last session, what's next
2. **Read the plan**: `docs/plan.md` — the single source of truth for what's supposed to happen across phases. Find the current phase and its tasks
3. **Read constraints**: `CLAUDE.md` — session protocol + invariants + what-not-to-do (refresh before generating worker prompts so the rules carry through)
4. **Git state**: `git log --oneline -15` and `git status` to verify repo matches `PROGRESS.md`
5. **Worktrees**: `git worktree list` — any stale worker worktrees?
6. **Health check**: `bash scripts/dev-init.sh` if it exists; otherwise check Docker stack: `docker compose -f infra/docker-compose.dev.yml ps 2>/dev/null`
7. **Code quality agent** (spawn an Explore subagent to run in parallel):
   - If `package.json` exists: `pnpm test --silent 2>&1 | tail -20`, `pnpm lint 2>&1 | tail -20`, `pnpm typecheck 2>&1 | tail -20`
   - Report pass/fail counts and any blocking issues
8. **Existing prompt files check**: does `PROMPT_INSTANCE_A.md` or `PROMPT_INSTANCE_B.md` already exist? If so, read their contents — a prior round may be incomplete, in which case you should NOT overwrite them without asking

## Phase 2: Analyze & report

After gathering all state, produce a **Session Report**. Keep it scannable — bullets, not paragraphs.

```
## Session Report — [absolute date]

### System Health
- Tests: [pass / fail / not yet]
- Lint: [clean / N issues / not yet]
- Types: [clean / N issues / not yet]
- Docker: [stack state]
- Branch: [current] — [clean / N uncommitted]
- Worktrees: [list or "none"]

### Since Last Session
- [What changed — commits, branches, any drift from PROGRESS.md]
- [Any incomplete work or loose ends discovered]

### Current State Summary
- [2-3 bullets on what's built and working]
- [Key integration points that are live vs stubbed]
- [Current phase per docs/plan.md]

### Priority Items
1. [Highest priority based on plan + current state]
2. [Second priority]
3. [Third priority]
(Cite source: plan phase, PROGRESS.md next-up, or discovered issue)

### Issues Found
- [Any bugs, test failures, lint errors, or regressions discovered during review]
- [Any architectural concerns worth addressing]
```

## Phase 3: Decision check

Before generating worker prompts, **ask the user** about:

- Whether the identified priorities are correct, or if they want to override with something specific
- Any key architectural decisions that would affect the work split
- Any constraints ("don't touch the AI layer today", "focus on tests only", etc.)

**Do NOT ask about:**

- Implementation details (variable names, file organization) — workers decide these
- Anything derivable from `docs/plan.md` or the existing codebase
- Minor decisions the workers can make themselves

Wait for user input before proceeding to Phase 4.

## Phase 4: Generate worker prompts

Create two files at the repo root: `PROMPT_INSTANCE_A.md` and `PROMPT_INSTANCE_B.md`. These files are gitignored — they're per-round artifacts, regenerated fresh each round.

Each worker prompt MUST follow this template:

```markdown
# Instance [A/B]: [Short Title]

## Context

You are one of two parallel Claude instances working on budget-tracker. The other instance is working on [brief description of their scope].

Read `CLAUDE.md` for project conventions and invariants. Read `PROGRESS.md` for current state. Read `docs/plan.md` to find the phase this round belongs to.

**Your worktree branch:** `feature/[descriptive-branch-name]`
**Other instance is working on:** [brief description — what, not how]

## Scope

**You own these files/directories (and ONLY these):**

- [explicit file/dir list — prevents merge conflicts]
- [...]

**Do NOT modify:**

- [files owned by the other instance]
- `CLAUDE.md`, `PROGRESS.md`, `docs/plan.md`, `.claude/skills/**` (shared — coordinator manages)
- [any other explicit carve-outs]

**Conflict prevention:** Your branch touches only [list]. Other instance's branch touches only [list]. No file overlap — no rebase conflicts possible.

## Tasks

Work through these in priority order. Use TodoWrite (or TaskCreate) to track progress. Each task has a clear done-criterion.

1. [ ] **[Specific, actionable task title]**
   - File(s): [exact paths, with line numbers where applicable]
   - Change: [what to do]
   - Done when: [specific observable state]

2. [ ] **[Next task]**
   - ...

## Decision Guidelines

- **For implementation choices** (naming, patterns, small structure decisions): use your judgment, follow existing conventions in the codebase or the referenced OSS inspirations
- **For scope questions** ("should I also fix X that I noticed?"): only if it's in your file ownership list AND takes < 5 minutes AND you can justify it in one sentence. Otherwise, note it as a follow-up in the PR description
- **For architectural questions** (should this be a new module? new abstraction? new dependency?): **ask the user** — do not guess
- **For ambiguous requirements**: **ask the user**

## When Done

1. Run the full local check in your worktree:
   ```
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm build   # if relevant to your scope
   ```
   (If the repo is pre-Phase-0b and `package.json` doesn't exist yet, skip these and confirm your files exist and parse.)
2. Commit to your feature branch with a descriptive Conventional Commit message.
3. Push the branch: `git push -u origin <branch>`
4. Open a PR: `gh pr create --base main --head <branch>` — title and body describe what you did, what you deferred, and any follow-ups you noted
5. Show the user the PR URL and a brief summary (files changed, tests passing)
6. **Do NOT merge the PR yourself.** The user merges after coordinator review.
7. **Do NOT update `PROGRESS.md`** — the coordinator manages that file.
```

### Prompt generation rules

- **No overlapping file ownership.** If both instances need to touch a shared file, assign it to one and have the other note it as a dependency.
- **Tasks must be concrete.** "Scaffold the database package" is bad; "Create `packages/db/schema/family.ts` with the `family` table per `docs/data-model.md#family`" is good.
- **Include line numbers / specific references** where possible so workers don't waste time searching.
- **Size each instance's work to roughly one sitting** (~30–90 minutes). If there's more work, prioritize and defer the rest.
- **Each prompt is self-contained.** A worker should be able to start from just the prompt + `CLAUDE.md` + `PROGRESS.md` + `docs/plan.md`.
- **Align each prompt to one side of the plan's phased rollout.** Don't mix phases across instances in one round.

## Phase 5: Handoff

After writing the prompt files, give the user a brief summary:

```
Worker prompts written:
- **Instance A** — [title]: [1-line scope summary]
- **Instance B** — [title]: [1-line scope summary]

To start workers, paste each in a new Claude Code session:
  /start-worker A
  /start-worker B

They'll create worktrees at .worktrees/instance-A and .worktrees/instance-B, execute the tasks, and open PRs. When both have opened PRs, come back here and run /review-workers.
```
