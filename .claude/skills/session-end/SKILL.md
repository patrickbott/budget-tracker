---
name: session-end
description: Update PROGRESS.md at the end of a budget-tracker session. Summarizes what was done, commits, next steps, blockers, environment state. Enforces the CLAUDE.md session protocol.
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Write, Bash
---

# Session End Protocol

Update `PROGRESS.md` to reflect what actually happened this session. Per `CLAUDE.md`: `PROGRESS.md` is a **transient working file**, overwritten each session — it is NOT documentation.

## Steps

1. **Gather session delta:**
   - `git log --oneline` — commits since the date/commit in the current `PROGRESS.md` "Last Session"
   - `git status` — uncommitted work
   - `git branch --show-current` — current branch name
   - `git worktree list` — active worktrees
   - If known from this session, test count: `pnpm test --silent 2>&1 | tail -5 || echo "(tests not run)"`

2. **Read current `PROGRESS.md`** to preserve format (sections, tone, voice).

3. **Draft the new `PROGRESS.md`** with these sections:
   - **Last Session**: today's absolute date (e.g., `2026-04-09`), branch, 3-6 bullet summary of what was actually accomplished
   - **Next Up**: numbered list of priority items for the next session, with enough specificity that the next coordinator doesn't have to re-derive what they are. If the next session is a `/start` parallel round, sketch the likely worker splits
   - **Blockers / Open Decisions**: anything still unresolved
   - **Environment State**: test count, Docker services needed, pnpm/Node versions, any stray `PROMPT_INSTANCE_*.md` files
   - **Notes for Next Session's Coordinator** (optional): tips, non-obvious things to remember, "read this file first"

4. **Show the user the full draft** before writing. Wait for approval.

5. **Write** the approved draft to `PROGRESS.md` (overwrite, don't append).

## Rules

- Scannable in 10 seconds — aim for < 60 lines total in the final file
- Convert relative dates to absolute ("today" → `2026-04-09`)
- Do NOT treat `PROGRESS.md` as documentation — never reference it from `docs/**`
- Do NOT add a session changelog or history — overwrite the previous content
- If there were no meaningful changes this session, tell the user and ask whether to update at all
- If a parallel round completed this session (via `/start` + `/review-workers`), note which round + what was merged
- Delete `PROMPT_INSTANCE_A.md` / `PROMPT_INSTANCE_B.md` at the end of the round once their PRs are merged (or tell the user they still exist)
