# Contributing

Thanks for your interest in contributing to **NaN Dashboard**.

## Reporting Issues

Use the GitHub issue tracker to report bugs, feature requests, or questions.
Include as much detail as possible:

- Steps to reproduce the issue
- Expected vs. actual behavior
- Plugin version and Stream Deck+ firmware
- Relevant log files (`com.refactor-ia.nan.sdPlugin/logs/`)

## Pull Requests

1. Fork the repository and create a feature branch from `main`.
2. Make your changes. Ensure the build passes:

   ```sh
   pnpm install --frozen-lockfile
   pnpm check:workspace
   pnpm test:workspace
   pnpm build
   ```

3. Add tests for new functionality. Run the full test suite:

   ```sh
   pnpm test:workspace
   ```

4. Submit a pull request with a clear description and any relevant screenshots or logs.

## Project history

Public history starts at the sanitized source import. Contributions proceed normally from that point; refer to the retained provenance notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Code Style

- TypeScript strict mode is enforced.
- Follow existing patterns in the codebase — no comments in production code.
- Keep changes focused and reviewable.

## License

By contributing, you agree that your contributions will be licensed under the
MIT License.

## Project metadata

The root package is marked `private: true` and is not published to npm.
The repository boundaries are plugin source (`src/`), native helper code (`native/`), build and release scripts (`scripts/`), and tests (`test/` and `scripts/*.test.mjs`).
The repository lives under the `refactor-ia` GitHub organization; the npm package is unscoped (`streamdeck-nan`) and marked `private: true` for internal development. The `com.barbatdev.ai-usage.nan-session` Keychain identity is a historical compatibility name pinned by contract tests and must not be renamed.