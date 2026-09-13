# Gemini PR Reviewer

## Purpose

This workflow adds Gemini as an independent reviewer of pull-request metadata
and bounded diffs. It complements the existing implementation and CI workers;
it never replaces their test evidence or owner approval gates.

## Default safety posture

The workflow is disabled by default. It will not run until an owner explicitly
enables the repository variable `GEMINI_REVIEW_ENABLED=true` after this PR is
merged and the required environment secret has been configured.

While enabled, it:

- runs only for non-draft pull requests from branches in this repository, or
  for an owner-triggered manual review;
- fetches at most 30 changed files, truncates each patch, and rejects an
  oversized review payload;
- sends only PR metadata and those bounded patches to Gemini;
- gives Gemini no checkout, shell, Git, Supabase, deployment, production, or
  secret-management access;
- can write one updatable review comment to the pull request using the
  workflow's `GITHUB_TOKEN`;
- never merges, pushes code, changes data, or starts a deployment.

Pull-request content is treated as untrusted input. The review prompt tells
Gemini not to follow instructions embedded in code, file names, titles, or
pull-request text.

## Activation (owner-only, after merge)

1. Create GitHub Environment `ai-review`. Do not grant it access to
   Staging or Production secrets.
2. Add only `GEMINI_API_KEY` to that Environment. Use a key dedicated to
   this review automation; do not reuse any application, Supabase, Resend,
   Claude, or Production credential.
3. Add repository variable `GEMINI_REVIEW_ENABLED` with value `true`.
4. Optionally set `GEMINI_REVIEW_MODEL`; otherwise the workflow uses
   `gemini-2.5-flash`.
5. Open or synchronize a same-repository PR, then inspect Gemini's comment.

The API key and enabling the workflow may consume Gemini quota or incur costs
depending on the Google account configuration. Activation therefore requires
explicit owner approval.

## Review boundaries

Gemini is advisory only. A Gemini "approve" verdict is not an approval to:

- merge a pull request;
- deploy to any environment;
- modify Staging or Production;
- add or change secrets, credentials, migrations, RLS, or data;
- make a purchase or public release.

Those operations remain governed by `AGENTS.md` and the project's explicit
owner-approval gates.
