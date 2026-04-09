# AI Tools Reference

> The typed financial-query tools that back all four AI features (chat, passive insights, auto-categorization, proactive coaching). Lives in `packages/ai/tools/` from Phase 3 onward. Design inspired by Maybe Finance's function-calling approach and Lunch Money's API primitives.

## Design principles

1. **Function calling, not RAG.** The LLM does not see transaction rows directly. It calls typed functions with typed arguments and receives typed, PII-stripped results.
2. **Same tools power every AI feature.** Chat, passive weekly insights, auto-categorization rule induction, and proactive coaching all call into the same set of functions. Different entry points, same primitives.
3. **PII stripped at the tool boundary.** No emails, no phone numbers, no account numbers, no real names ever leave the tool functions. The model cannot accidentally leak what it never saw.
4. **Deterministic over probabilistic.** Wherever possible, the model's job is to **ask the right questions** — not to do math. The tools do the math.
5. **Each tool is scoped to the current `family_id`.** Enforced by Drizzle middleware setting the Postgres session variable before any tool function runs. No cross-family leakage possible.
6. **Each tool has a strict Zod schema** for input AND output. These schemas are converted to JSON Schema for the Anthropic `tool_use` API and validated at runtime.

## Tool catalog

| Tool | Purpose | Typical caller |
|---|---|---|
| `get_net_worth(as_of_date)` | Assets − liabilities at a point in time, broken out by account type | Chat, insights, dashboard |
| `spending_by_category(start, end, filters?)` | Aggregates, excluding transfers. Optional filters for accounts, tags, min/max amount | Chat, insights, auto-cat |
| `cashflow(period, granularity)` | Income − expense by month/week/day | Chat, insights, coaching |
| `find_transactions(query, filters?, limit?)` | Full-text + structured search over the transaction list. Hard-limited to 50 results | Chat, rule induction |
| `budget_status(period)` | Per-category actual vs cap/forecast, status color, % consumed | Chat, insights, coaching, dashboard |
| `recurring_status()` | Every recurring series + `missing_dates`. "Rent is 3 days late" | Chat, coaching |
| `compare_periods(period_a, period_b, dimensions?)` | Period-over-period deltas with dimension breakdown | Chat, insights |
| `forecast_month_end(category?)` | Linear + trend-adjusted projection. Optional category scope | Chat, coaching, insights |
| `explain_variance(category, period)` | "Why is dining up 40%?" — returns the driver transactions | Chat, insights |
| `find_subscriptions()` | Detects recurring small-amount charges, flags stale/unused ones | Chat, insights, coaching |
| `saving_opportunities()` | Surfaces high-spend categories, unused subscriptions, fee accumulation | Insights, coaching |
| `propose_rule(example_entry_id, target_category)` | Drafts a categorization rule from a concrete example. Returns the rule spec for user acceptance | Auto-cat, chat |
| `get_goal_progress(goal_id?)` | Progress vs target, projected completion | Chat, insights |
| `list_categories()` | Directory lookup — category names, IDs, hierarchy. Used by the model to map natural-language names to IDs | Chat (prereq) |
| `list_accounts()` | Directory lookup — account names, IDs, types, visibility. Used to map NL → IDs | Chat (prereq) |
| `run_read_query(sql)` | **Escape hatch.** Read-only SQL scoped to current family via RLS. For questions the typed tools can't express. Time-limited, row-limited, logged for audit | Chat only |

## PII stripping

Every tool's return shape goes through a PII stripper before the result reaches the model. The stripper has its own red-team test suite in `packages/ai/pii-stripper.test.ts`.

**Stripped fields:**
- Emails (regex)
- Phone numbers (regex, multiple formats)
- Full account numbers (>= 6 digit sequences)
- SSN-shaped strings
- Bank routing numbers (9-digit sequences starting with specific prefixes)
- Human names on transaction descriptions (best-effort; flagged in the audit log)

**Never in tool outputs:**
- The user's real name
- User email addresses
- Account numbers in full (last 4 only, if at all)
- Addresses beyond city-level
- Other users' identifying info

## Tool-use loop

Standard Anthropic tool-calling:

```
1. User sends a chat message
2. Model responds with either:
   a. A final text response → done
   b. One or more `tool_use` blocks
3. For each tool_use, we:
   - Validate input args against the Zod schema
   - Execute the tool function
   - Validate output against Zod schema
   - PII-strip the output
   - Wrap in a `tool_result` block
4. Feed the tool_result blocks back to the model
5. Goto step 2
```

Max iteration depth: 10 (to prevent runaway tool loops).

## Model routing

| Feature | Model | Why |
|---|---|---|
| Chat | Claude Opus 4.6 | Best reasoning, handles multi-step tool chains cleanly, streaming for UX |
| Auto-categorization | Claude Haiku 4.5 | Cheap, fast, categorization is a well-bounded task |
| Weekly/monthly insights | Claude Haiku 4.5 | Batch job, structured output, cost-sensitive |
| Proactive coaching | Claude Haiku 4.5 | Short responses from structured inputs |

Prompt caching is enabled on the system prompt + full tool-definition block, which typically accounts for ~80% of input tokens. This brings the effective cost per chat message down dramatically.

## Spend controls

- **Hard monthly cap per family**: default `$10 USD` (configurable via `AI_MONTHLY_SPEND_CAP_USD`)
- **Usage tracking**: `ai_usage` table, rolled up daily
- **Warning threshold**: 80% of cap → in-app banner
- **Block threshold**: 100% of cap → chat returns "Monthly AI quota reached" message; batch jobs skip until next month; coaching disabled
- **Per-request max tokens**: capped at 4096 output tokens for chat, 1024 for batch

## Audit log

Every tool call is logged to the `chat_message.tool_calls_json` column (for chat) or `insight.tool_calls_json` (for batch jobs). The log contains:
- Tool name
- Input args (PII-stripped)
- Output shape (not full output — just keys and types)
- Execution time
- Any errors

This is useful for:
- Debugging "why did the AI say that?"
- Cost auditing (tool calls → token usage)
- Red-teaming the PII stripper
- Regression testing (we can replay historical tool calls against new code)

## What this does NOT do

- **No write tools.** The AI cannot directly modify data. It can propose rules, categorizations, and transfers — but the user must accept them via a UI step. This is deliberate: the AI is an advisor, not an autonomous agent, in a finance context.
- **No internet access.** Tools only read from the local database. No web search, no news lookup, no stock prices beyond what's stored.
- **No cross-family data.** RLS enforces that the tools only see the current family's data. No way to compare against "other users in similar situations".
- **No raw SQL by default.** The escape-hatch `run_read_query` exists but must be explicitly enabled per-family via a user setting. Off by default.
