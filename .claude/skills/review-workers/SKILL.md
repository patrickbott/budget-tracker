---
name: review-workers
description: Use after /start-worker A and/or B have finished their tasks and opened PRs, when you need a review pass before merging and running /start for the next round.
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash, Agent, TaskCreate, TaskUpdate, TaskList
argument-hint: [optional A, B, or blank for both]
---

# Worker PR Review Protocol

You are the **coordinator Claude** running a review pass between the worker round and the next `/start`. Your job is to substantively review Instance A's and Instance B's PRs, produce per-PR verdicts, and hand back a clear merge decision to the user. You do NOT merge PRs. You do NOT fix bugs. You read, verify, and report.

If an argument was provided: `$ARGUMENTS` (either `A`, `B`, or empty for both).

## Core principles

1. **Green CI is necessary but not sufficient.** CI catches broken tests, lint, and types. It does not catch logical bugs, misread requirements, scope creep, bad design, or false claims in the PR body. Read the actual code.
2. **Verify scope compliance.** Every worker prompt has a "You own these files/directories" list. Cross-check the actual changed files against that list. Scope violations are worth flagging even if the code is good.
3. **Verify claims in the PR body.** If the PR body says "all tests passing" or "100% scope compliance" or "no new dependencies", sanity check those claims. Fabricated claims are a bigger problem than missed bugs.
4. **Blocking vs. nitpick is a meaningful distinction.** A nitpick can land in a follow-up or the next round. A blocker stops the merge. Mix them up and the user can't act on your verdict.
5. **You do not merge.** The user merges on GitHub after reading your verdict. You do not force-push, close PRs, or delete branches.
6. **You do not fix.** If you find a bug, report it. Do not edit the worker's code — that defeats the purpose of the review and creates merge conflicts with their worktree.

## Phase 1: Detect state (parallel)

Run these in parallel using Bash and direct reads:

1. **Fetch latest from origin:** `git fetch --all --prune`
2. **List open PRs from worker branches:** `gh pr list --state open --json number,title,headRefName,mergeable,statusCheckRollup,updatedAt`
3. **Check worktrees:** `git worktree list`
4. **Per-worker worktree state** (skip if the user's arg excludes one):
   - `git -C .worktrees/instance-A status`
   - `git -C .worktrees/instance-A log --oneline -10`
   - `git -C .worktrees/instance-B status`
   - `git -C .worktrees/instance-B log --oneline -10`
5. **Read the prompts** — `PROMPT_INSTANCE_A.md` and `PROMPT_INSTANCE_B.md` (or just the one specified). These contain the scope/ownership lists you'll check against
6. **Read `PROGRESS.md`** — what phase/round is this?
7. **Read `docs/plan.md`** — what should the work be doing?

### Completion check

For each worker you're reviewing, confirm they're actually done before reviewing:

| Signal | Means |
|---|---|
| PR open + CI green + worktree clean | Done — proceed to Phase 2 |
| PR open + CI running | Wait, or ask user if they want a partial review |
| PR open + CI failing | Report the failure; do not review further until worker fixes |
| Worktree has uncommitted changes | Worker is still working — report and stop |
| No PR opened | Worker hasn't pushed — report and stop |
| Worktree does not exist | Worker hasn't started or already cleaned up — ask user |

**If a worker isn't done, stop and tell the user.** Do not half-review an in-progress branch.

## Phase 2: Substantive review (per PR)

For each PR that passed the completion check, run this loop.

### 2a. Get PR metadata

```bash
gh pr view <N> --json state,mergeable,mergeStateStatus,statusCheckRollup,title,body,additions,deletions,files,headRefOid
```

Record: title, mergeable state, CI results, commit SHA, file count, +/- lines.

### 2b. Check scope compliance

From the worker's `PROMPT_INSTANCE_*.md`, extract the "You own these files/directories" list. Then compare against the files actually changed in the PR:

```bash
git -C .worktrees/instance-X show <commit> --stat
# or
gh pr diff <N> --name-only
```

For every file in the diff, verify it appears (or a parent directory appears) in the ownership list. **Any file outside scope is a finding.** Exception: files explicitly carved out as "shared but assigned to this instance" in the prompt.

Common scope violations to flag:

- Touching `CLAUDE.md`, `PROGRESS.md`, `docs/plan.md`, or `.claude/skills/**` without authorization
- Touching files owned by the other instance (merge conflict risk)
- Touching files from a completely unrelated area ("while I was here" drift)
- Adding new packages outside the declared scope
- Modifying `package.json` in a package not listed in ownership

### 2c. Verify PR body claims

Read the PR body. For each quantitative claim, verify:

- **Test counts** — if the worker claims "X tests passing", re-run or cross-check against CI
- **"Zero drift" / "no breaking changes"** — treat with healthy skepticism. Check what the assertion is measuring
- **Dependency additions** — if the worker claims "no new dependencies", grep the diff for `package.json` changes
- **Completed task claims** — for each task they claim done, spot-check the file they touched actually does the thing

Don't re-run the worker's tests yourself — they're already in CI. But sanity-check the numbers are internally consistent and the work matches the description.

### 2d. Read the substantive code

This is the part CI doesn't do for you. Do NOT read every file. Prioritize:

1. **Any file affecting data integrity** — schema migrations, database writes, transactions, entry/entry_line construction, amount handling
2. **Any file affecting auth, access control, or multi-tenancy** — auth middleware, RLS policies, family scoping, personal vs household visibility
3. **Any file on the SimpleFIN sync path** — parsing, dedup, pending transitions, transfer detection
4. **Public API surface changes** — route handlers, server action signatures, exported type changes
5. **New abstract types or interfaces** — any change to a shared type affects every consumer
6. **Any file touching AI tool definitions or the PII stripper** — these have hard security implications

Use `git -C .worktrees/instance-X show <commit> -- <file>` or `gh pr diff <N> -- <file>` to read the diff per file. For very large PRs, consider delegating the first-pass read to an Explore subagent.

**What to look for:**

- **Bugs** — off-by-one, wrong branch in conditionals, swallowed exceptions, race conditions, unhandled null/undefined, `parseFloat` on amounts (BANNED), missing `family_id` scoping
- **Regressions** — changes to existing behavior that weren't asked for
- **Silent failures** — `catch { }`, fallbacks that mask real errors, default values that hide misuse
- **Invariant violations** — any code path that constructs an `entry` without using `packages/core/entries/` and its double-entry enforcement
- **Security gaps** — trusted user input passed to SQL, missing auth checks, PII that escapes the tool boundary
- **Interface consistency** — if a shared type changed, did all consumers update?
- **Test quality** — does the test actually exercise the failure case, or does it pass trivially?

### 2e. Verify it merges cleanly

```bash
gh pr view <N> --json mergeable,mergeStateStatus
```

`mergeable: MERGEABLE` + `mergeStateStatus: CLEAN` means the branch fast-forwards or auto-merges against current main. If not CLEAN, note the conflict.

## Phase 3: Per-PR verdict report

Produce one report block per PR you reviewed. Use tables and bullets, not paragraphs.

```markdown
## PR #<N> — <title>

### Verdict: APPROVED / APPROVED_WITH_NITS / CHANGES_REQUESTED / BLOCKED

### CI
- lint: SUCCESS / FAILED (<details>)
- typecheck: SUCCESS / FAILED (<details>)
- test: SUCCESS / FAILED (<details>)
- build: SUCCESS / FAILED / NOT RUN
- mergeable: MERGEABLE + CLEAN / DIRTY (<conflict summary>)

### Scope
- <N> files changed, all within declared ownership / <N> violations
- If violations: list file + what the worker's ownership list was

### Strengths
- 2–5 bullets: what was done well, clever fixes, better-than-asked-for outcomes
- Cite specific files/lines where possible

### Concerns — blocking (if any)
- Each blocker with: what the issue is, which file/line, why it matters, what the worker should change
- If no blockers: "None."

### Concerns — non-blocking / nitpicks
- Things that could be cleaned up but shouldn't hold the merge
- Include scope-creep candidates for the next round

### Claims verification
- Test count claimed: <N>. Verified: <yes / no / partial>
- Other numeric claims spot-checked: <summary>

### Recommendation
- MERGE — ship it, no changes needed
- MERGE WITH FOLLOW-UP — merge now, address nitpicks in next round
- REQUEST FIXUPS — ask the worker to address specific blockers, then re-review
- BLOCKED — something needs user decision (scope question, design choice, etc.)
```

## Phase 4: Handoff

After both verdict blocks, give the user a top-level summary and a concrete next-action block. Match the state you found:

### Case A: Both PRs APPROVED

```
Both PRs ready to merge. Next steps:

  gh pr merge <A#> --squash --delete-branch
  gh pr merge <B#> --squash --delete-branch
  git checkout main && git pull
  git worktree remove .worktrees/instance-A --force
  git worktree remove .worktrees/instance-B --force
  rm PROMPT_INSTANCE_A.md PROMPT_INSTANCE_B.md

Then run /start to plan the next round, or /session-end to wrap up for now.
```

### Case B: One APPROVED, one needs fixups

```
PR #<approved> ready to merge.
PR #<needs-fixups> needs: <specific list of blockers>.

Suggested: either
  (a) Merge #<approved> now, ask worker to push fixups on #<other>, re-run /review-workers B
  (b) Wait on both until the other worker fixes; merge together
```

### Case C: Both need fixups

```
Neither PR is ready to merge. Blockers:
- PR #<A>: <blockers>
- PR #<B>: <blockers>

Ask each worker to push fixups, then re-run /review-workers when they're done.
```

### Case D: One worker not done

```
PR #<done> reviewed (see verdict above).
Instance <other> is still working (status: <signal from Phase 1>).

Options:
- Merge #<done> now and wait on the other
- Wait for both and review together
```

## Handling re-review on fixup commits

If the worker pushes fixups after your first review pass, the user will typically re-invoke this skill. On re-invocation:

1. Detect the new commits: `git -C .worktrees/instance-X log <previous-head>..HEAD --oneline`
2. If no new commits, the state is unchanged — tell the user and stop
3. Otherwise, scope the re-review to the **new commits only**:
   - `git -C .worktrees/instance-X show <new-sha> --stat`
   - `git -C .worktrees/instance-X show <new-sha>` (full diff)
4. Confirm CI re-ran on the new HEAD: `gh pr view <N> --json headRefOid,statusCheckRollup`
5. Check whether the fixups actually addressed the blockers from your previous review
6. Produce a shortened verdict report that references the prior review

Do NOT re-review the entire PR from scratch on fixup commits — that wastes context.

## Important rules

- **Don't trust the PR body alone.** Read the code.
- **Don't trust CI alone.** Read the code.
- **Don't trust "the commit message is thorough" as a proxy for correctness.** Read the code.
- **Don't fix bugs yourself.** Report them. The worker's worktree still exists; they can push fixups.
- **Don't merge PRs.** The user merges after reading your verdict.
- **Don't touch `CLAUDE.md`, `PROGRESS.md`, `docs/plan.md`, `.claude/skills/**`, or anything outside your review-reading.** You are a reviewer, not an editor.
- **If a scope violation is trivial and clearly in the spirit of the round, flag it anyway.** The user can choose to accept it; your job is to surface it.
- **If you find yourself writing "looks fine" for a file without having read the substantive diff, stop and go read it.** "Looks fine" with no justification is the failure mode this skill exists to prevent.

## When to escalate to the user

Stop and ask the user (don't guess) if:

- A worker's PR looks correct but contradicts a decision in `docs/plan.md` or an ADR
- Both workers' PRs touch the same file in a way the original prompts didn't anticipate
- The verdict is genuinely ambiguous (the code works but the design feels wrong)
- You find something that looks like a security issue but you're not sure
- The worker's PR body claims something you can't verify from the repo alone

## Quick reference — what to read per PR

| Situation | Read |
|---|---|
| Small PR (<500 lines, <10 files) | Every file in the diff |
| Medium PR (500–1500 lines) | Every critical file + spot-check the rest |
| Large PR (>1500 lines) | Critical files in full, delegate first-pass to an Explore subagent |
| Schema / migration change | Full schema file + the migration SQL + any code that uses the new fields |
| Auth / RLS change | Every route handler touched + the RLS policy definitions + the middleware |
| SimpleFIN ingest change | The full sync path + dedup logic + the fixture tests |
| New AI tool | The tool definition + the implementation + the PII stripper call + the tool test |
| New public API route (server action) | Request/response types + the handler + the auth check + tests |
| Refactor with no behavior change claimed | Spot-check for accidental behavior changes; run `git diff --stat` to see what's touched |
