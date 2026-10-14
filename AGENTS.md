# Development guidelines

## Repository safety

- Verify the checkout path, Git remote, active branch, and worktree before editing.
- Preserve unrelated local changes. Do not reset, force-push, or rewrite published history.
- Never commit API keys, credentials, local environment files, or personal learning exports.

## Branch workflow

- Keep `main` as the integration branch for completed, verified work.
- Create a topic branch from the latest verified `main` before making changes. Use `feature/`, `fix/`, or `docs/` with a descriptive name.
- Make focused commits with messages describing the change; avoid generic messages when committing directly.
- Push the topic branch to GitHub so work is recorded independently of deployment.
- Verify changes before integrating. For application changes, run the relevant tests and build. For documentation-only changes, check links and diffs.
- Review the diff, then merge completed work into `main`. Prefer a pull request when tooling is available; otherwise a checked local `--no-ff` merge is acceptable. Preserve individual commits by default.
- Do not merge incomplete work or work explicitly awaiting review or approval.
- Push `main` to GitHub and verify the remote commit matches the local result. Report any failed or omitted push rather than treating publication as GitHub synchronization.
- Do not delete remote branches without a request; retained topic branches must not be reused for unrelated work.

## Publication and data

- GitHub synchronization, hosted web publication, Chrome extension reload, and Supabase SQL application are separate operations.
- Publish completed web application changes only after integration, following the applicable Sites skill. Documentation-only changes do not need web publication.
- New Supabase migrations must preserve existing learning records and remain separate from vocabulary status and review schedules unless the task explicitly changes those behaviors.
- Do not assume migrations have been applied remotely. State any required manual SQL step and the limits of live verification.

## Public documentation

- Keep README focused on the product, usage, setup, and meaningful limitations for users and developers.
- Do not include conversation history, personal work-log or Contributions explanations, personal account details, machine-specific paths, credentials, or private deployment links.
- Keep agent development instructions in this file, generic and free of private context.
