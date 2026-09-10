# Security Policy

## Supported Versions

Only the latest release is supported. Users are encouraged to update promptly.

## Reporting a Vulnerability

**Do not open a public issue.** Instead, email the maintainer at:

`security@barbat.dev`

Or open a private GitHub Security Advisory via the "Security" tab of the repository.

Include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Scope

The following are in scope for security review:

- Plugin bundle (`com.refactor-ia.nan.sdPlugin/`)
- Source, native helper, scripts, and tests (`src/`, `native/`, `scripts/`, `test/`)
- Build scripts and CI configuration

The following are out of scope:

- Vulnerabilities in third-party CLIs (Claude, Codex, Grok)
- Vulnerabilities in the user's local environment
- Social engineering attacks against the maintainer

## Disclosure Policy

- We aim to acknowledge reports within 48 hours.
- We aim to release a fix within 30 days of a confirmed vulnerability.
- We will credit reporters in release notes unless they prefer anonymity.
- We follow coordinated disclosure: we will not publish details until a fix is available.

## Security Features

- Claude CLI: discovered via absolute paths, symlinks resolved, identity revalidated before execution.
- Codex CLI: spawn validated via absolute path, symlink check, env allowlist, `shell: false`.
- Grok CLI: spawn validated via env allowlist, `shell: false`.
- CLI child environments exclude parent token and API-key variables. They deliberately retain `HOME` and applicable local provider configuration paths for authenticated local use: `CLAUDE_CONFIG_DIR` and `XDG_CONFIG_HOME` for Claude, and `XDG_CONFIG_HOME` for Codex and Grok when set.
- The final validated-path-to-spawn interval remains a same-user filesystem residual shared by the Claude, Codex, and Grok CLI launches; it is not an atomic execution guarantee.
- All transports: `shell: false` and bounded response sizes.