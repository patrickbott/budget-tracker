---
name: start-worker
description: Execute a worker prompt (A or B) in a git worktree. Used by parallel Claude instances after /start generates the prompts.
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash, Write, Edit, Agent, TaskCreate, TaskUpdate, TaskList
argument-hint: [A or B]
---

# Start Worker Instance

You are a **worker Claude instance** executing a scoped set of tasks in a git worktree. You were launched from a separate Claude session than the coordinator that generated your prompt.

## Setup

1. Read `CLAUDE.md` — project conventions, invariants, what NOT to do
2. Read `PROGRESS.md` — current state of the project
3. Read `PROMPT_INSTANCE_$ARGUMENTS.md` — your specific assignment for this round
4. Read `docs/plan.md` (relevant phase section) — the bigger picture your work fits into
5. Extract your feature branch name from your prompt file (under `## Context` → "Your worktree branch")
6. Create a worktree and switch to it:
   ```bash
   git worktree add .worktrees/instance-$ARGUMENTS feature/<branch-name-from-prompt>
   cd .worktrees/instance-$ARGUMENTS
   ```
   If the branch already exists (resuming an in-flight round), check it out instead:
   ```bash
   git worktree add .worktrees/instance-$ARGUMENTS feature/<branch-name-from-prompt>
   # or if the worktree already exists:
   cd .worktrees/instance-$ARGUMENTS
   git status
   ```

## Execution

1. Parse the task list from your prompt file
2. Create a task list via TaskCreate (one task per checkbox in the prompt)
3. Execute each task in order; mark in_progress before starting, completed when done
4. After each meaningful change:
   - Run the relevant tests if they exist: `pnpm test --filter @budget/<package>`
   - If tests fail, fix before moving to the next task — do not stack broken changes
5. Follow the **Decision Guidelines** in your prompt — ask the user when it specifies to
6. **Stay strictly in scope.** If a task outside your file ownership list becomes tempting, note it as a follow-up for the PR description and move on

## Completion checklist

When all tasks are done:

1. Run the full checks from inside your worktree:
   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   # If your scope includes apps/web or a build-affecting package:
   pnpm build
   ```
   (If `package.json` doesn't exist yet — early Phase 0b — skip these and verify files exist, parse, and match the prompt's done-criteria)

2. `git status` — only files in your ownership scope should be modified. If any file outside scope is touched, undo it or move it to a follow-up note

3. Stage and commit with a Conventional Commit message:
   ```bash
   git add <specific files>
   git commit -m "feat(<scope>): <what you did>"
   ```

4. Push the branch:
   ```bash
   git push -u origin feature/<branch-name>
   ```

5. Open a PR referencing the round + instance:
   ```bash
   gh pr create --base main --head feature/<branch-name> \
     --title "[Round N Instance $ARGUMENTS] <title>" \
     --body "$(cat <<'EOF'
   ## Summary
   <2-3 bullet points of what this PR does>

   ## Tasks completed
   - [x] <task 1 from the prompt>
   - [x] <task 2>
   ...

   ## Tasks deferred (if any)
   - <task and reason>

   ## Scope verification
   All files in this PR are within the declared ownership:
   <list or "all files in <scope>">

   ## Follow-ups noted
   - <any out-of-scope items worth flagging>
   EOF
   )"
   ```

6. Show the user the PR URL and a brief summary: files changed, tests passing, any follow-ups noted.

7. **The user reviews the verdict from `/review-workers` and merges on GitHub.** Do not merge the PR yourself.

8. **Do NOT update `PROGRESS.md`** — that's the coordinator's file.

## Important rules

- **Stay in scope** — only modify files listed in your ownership section
- **Don't touch shared files** unless your prompt explicitly assigns them to you: `CLAUDE.md`, `PROGRESS.md`, `docs/plan.md`, `.claude/**`, root config files
- **If blocked** by something the other instance owns, note it as a follow-up in your PR description and move on
- **If you discover a bug** outside your scope, note it in your PR description — do NOT fix it (that's scope creep + merge conflict risk)
- **Follow every invariant in `CLAUDE.md`** — row-level security, NUMERIC(19,4) amounts, double-entry lines sum to zero, no parseFloat, PII strip at AI tool boundary. These are load-bearing and easy to forget when you're heads-down on a single task
- **Never force-push, never rebase onto main, never delete branches** unless the user explicitly asks. If CI fails on your PR, push a fixup commit — do not rewrite history
- **Never skip hooks** (`--no-verify`). If a pre-commit hook fails, fix the underlying issue
