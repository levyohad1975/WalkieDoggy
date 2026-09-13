# Walkie Doggy Agentic Autonomy V1.2

## Purpose

V1.2 adds an event-driven persistent execution entry point for the Release Candidate pipeline. It complements the repository Agentic V1 governance and the external hourly controller/watchdog.

The intended operating model is:

Owner → ChatGPT Control Room → GitHub event → Agentic RC Worker → repository/CI/non-Production evidence → next safe task → approval gate.

## What this adds

- `.github/workflows/agentic-rc-worker.yml`
- Automatic worker invocation after completion of the repository's `CI` or `Batch 2 Supabase Rehearsal` workflows.
- Manual `workflow_dispatch` fallback.
- A fixed Release Candidate queue and safety prompt embedded in the workflow so the worker does not depend on chat history.
- A concurrency lock so only one RC worker run executes at a time.
- A 30-minute workflow timeout and a 12-turn Claude limit to bound runaway execution/usage.
- `actions: read` access so the worker can inspect CI evidence and logs.
- Explicit no-merge/no-Production/no-destructive-operation gates.
- Safe no-op behavior when no Claude credential is configured.

## Authentication / activation boundary

The workflow is intentionally inactive unless exactly one supported Claude credential is configured as a GitHub Actions repository secret:

- `CLAUDE_CODE_OAUTH_TOKEN` — preferred when the owner's Claude plan supports `claude setup-token`.
- `ANTHROPIC_API_KEY` — direct Anthropic API authentication; this can incur API usage charges.

Do not commit either value to the repository. The workflow only references GitHub Actions secrets.

If neither secret exists, the workflow records an inactive-worker note in the GitHub Actions step summary and exits without repository mutation.

If both are present, the workflow prefers the OAuth token path. Operationally, configure only one to keep the authentication source unambiguous.

The Claude GitHub App must also be installed/authorized for this repository when required by the selected authentication path.

## Event model

The worker is invoked on:

1. completion of `CI`;
2. completion of `Batch 2 Supabase Rehearsal`;
3. explicit `workflow_dispatch`.

The worker does not use issue/PR comment text as an autonomous trigger. This avoids feeding arbitrary user-authored prompt content into a secret-bearing workflow.

The V1.1 stacked-PR workflow trigger change is a prerequisite for reliable event coverage of stacked PRs such as PR #11.

## Execution behavior

On every invocation the worker must:

1. read `AGENTS.md`;
2. read `EXECUTION_STATE.md` and `docs/engineering/AGENTIC_EXECUTION_V1.md` when present;
3. reconstruct current state from fresh repository/GitHub evidence;
4. inspect the upstream workflow result;
5. on failure, diagnose logs and attempt the smallest safe repository-side recovery;
6. on success, move to the next actually executable safe RC task rather than merely report success;
7. produce fresh evidence;
8. stop only when no safe task exists or a genuine owner approval gate is reached.

Monitoring alone is not completion evidence.

## Release Candidate queue

The embedded worker prompt preserves the locked queue order:

1. Staging family-creation E2E through second-member join.
2. `AUTO_APPROVE_NEW_FAMILIES` true/false plus System Admin approve/reject.
3. Welcome/system-owner email, Resend webhook, and `email_delivery_log`.
4. Settings/Roles/System Admin QA and release-blocking fixes.
5. Batch 4 regression.
6. Real iPhone E2E / RTL / navigation / family flows.
7. Full CI and Supabase regression.
8. QA Guardian.
9. Release Candidate approval gate — stop for owner approval.

## Autonomous authority

The worker may autonomously perform safe, reversible, non-Production work supported by its available tools, including repository inspection, code/workflow edits, typecheck/tests, CI/rehearsal investigation, bounded retries, and preparation/update of non-main feature/PR work.

The workflow does not grant authority to:

- merge a PR;
- direct-push `main`;
- deploy to Production;
- run Production migrations;
- change Production data, RLS, secrets, credentials, or environment;
- perform destructive/irreversible actions;
- make purchases/charges;
- publish publicly.

Those remain explicit owner approval gates.

## Staging credentials

V1.2 does not add Supabase or Resend credentials. Live Staging E2E will remain blocked until appropriately scoped non-Production credentials are deliberately configured. Any future Staging credentials should be:

- limited to the non-Production project/environment;
- stored only in GitHub environment/repository secrets or another approved secret store;
- inaccessible to untrusted workflows;
- never echoed to logs;
- incapable of mutating Production.

A separate reviewed change should define the exact Staging secret list and environment protection before those credentials are added.

## Relationship to the hourly controller

The GitHub event worker is the primary event-driven execution mechanism once activated. The hourly ChatGPT controller remains a watchdog/fallback for stale state, missed events, and governance reporting; it should not duplicate an already-running worker task.

## Activation checklist

Before enabling live Claude execution:

- [ ] Agentic V1 governance reviewed.
- [ ] Stacked-PR CI trigger fix reviewed.
- [ ] This V1.2 workflow reviewed.
- [ ] Claude GitHub integration installed/authorized if required.
- [ ] Exactly one Claude auth secret configured.
- [ ] Usage/billing implications understood for the chosen auth method.
- [ ] No Production credentials exposed to this workflow.
- [ ] Trigger with `workflow_dispatch` once and verify the first run produces bounded, non-Production evidence.

Merging or enabling credentials is not part of this documentation change and remains owner-controlled.
