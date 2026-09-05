# LatticeTerm repository instructions

## Project boundaries

- LatticeTerm is a public open-core project. Keep the desktop core auditable and reserve hosted collaboration services for the commercial layer.
- Never commit credentials, API tokens, private hosts, customer data, local account files, generated secrets, or machine-specific configuration.
- Preserve unrelated user and collaborator changes. Modify only files required by the current task.

## Collaboration

- Use Taiwan Traditional Chinese for user-facing discussion and project documentation unless a file is intentionally English.
- Before editing, inspect the affected source, tests, configuration, current branch, upstream state, and relevant project documentation.
- Create commits, push branches, open pull requests, or publish releases only when the user explicitly requests delivery.
- Commit titles use `<type>(<scope>): <subject>` with natural Taiwan Traditional Chinese. Keep each commit focused on one meaningful change.
- Follow https://ithelp.ithome.com.tw/articles/10228738 for commit messages: use Traditional Chinese, keep the subject within 50 characters without a final period, and explain both what changed and why in the body (wrap at 72 characters). Add actual issue references when available and describe incompatible changes with `BREAKING CHANGE:`; never invent an issue number.

## Verification

- Frontend changes must pass `npm run typecheck`, relevant Vitest coverage, and the production build or an explicitly documented narrower check.
- Rust changes must pass `cargo fmt --all -- --check`, `cargo check`, and relevant tests where the current platform can execute them.
- Treat local checks, CI, release assets, and an installed application as separate verification boundaries. State any boundary that was not verified.
- For security-sensitive file writes, preserve existing content, reject unsafe path shapes and external-write conflicts, and prefer recoverable or atomic replacement.

## Delivery

- Before push or PR work, fetch the remote, compare branch and upstream, review the staged diff, and include only task files.
- Do not force-push collaborator work. Use a force update only when the user explicitly requests history rewriting and the exact remote branch is verified.
