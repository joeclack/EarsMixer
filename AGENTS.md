# EarsMixer server guidance

Read [the server and API guide](lib/AGENTS.md) for console, HTTP and WebSocket changes and [the design system](DESIGN_SYSTEM.md) for UI work.

## Branches, commits and pull requests

- Base new work on `main` unless the task specifies another base or belongs on an existing feature branch. Use `<type>/<short-kebab-case-description>` for new branches. Common types are `feat`, `fix`, `refactor`, `docs`, `test` and `chore`.
- Keep commits focused. Review the staged diff and use `<type>(<scope>): <imperative summary>` for commits and PR titles. Omit the scope for changes that span the repository.
- Review the full diff against the target branch and use [the PR template](.github/pull_request_template.md), including when opening a PR through a CLI or API. Link the relevant issue and any companion PRs when they exist.
- Record validation commands and outcomes under **Checks**, and automated tests and manual scenarios under **Tests**. Explain anything skipped or blocked and mark CI pending while it runs. Include screenshots or recordings for visible changes and identify the platforms exercised.
- Update [PLAN.md](PLAN.md) in the same PR when completing a listed item. Split partially completed items and tick a section only once its readiness criteria are verified.
- When delivering work through a PR, push the feature branch, open or update the PR against its target branch and include the link in the handoff. Merge only when requested.

## Review

- Read surrounding code and affected callers. Check regressions, data loss, privacy, access boundaries, broken flows and gaps in coverage. Preserve existing test coverage and explain intentional expectation changes.
- Report actionable findings in severity order with the file, line, affected scenario and impact. State the checks run and any remaining verification. Use [SECURITY.md](SECURITY.md) for private vulnerability reporting.

## Development

- Use Node.js 22.13+ and npm. Run `npm test` for server changes and `npm run build` for browser or admin asset changes. Use `npm run dev` to exercise the mock console and keep live desk verification explicit in the PR.
- Edit browser source in `web/mixer.js` and `web/mixer.css`, and admin source in `admin/src/`. Use the package build scripts to regenerate outputs.
- When changing installed behaviour, consider fresh installs, upgrades, and preservation of settings and data on Windows and macOS. Follow [the release instructions](README.md#packaging-and-releases) for package and product versions.
