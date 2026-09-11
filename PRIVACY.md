# Privacy Policy — NaN Dashboard for Stream Deck

_Last updated: 2026-09-11. Applies to the NaN Dashboard Stream Deck plugin by Refactor IA._

## What the plugin accesses

- **Chrome cookies for NaN domains only.** When you explicitly click **Import session from Chrome** in a NaN action's configuration panel, the plugin reads cookies from your local Chrome profile, filtered to NaN-owned domains, to build a single dashboard session. It never reads cookies for other sites, never reads saved passwords, browsing history, or other browser data.
- **macOS Keychain.** The plugin uses the Chrome Safe Storage key (via the system Keychain) to decrypt only the NaN session cookies, and stores the validated session in its own Keychain item (`com.barbatdev.ai-usage.nan-session`, a compatibility identity). Keychain prompts come from macOS.
- **NaN Dashboard API.** With your session, the plugin queries fixed NaN Dashboard endpoints to display your own quota, model usage and token metrics. All requests originate from your machine using your session.

## What we do NOT do

- No telemetry, analytics, crash reporting, or tracking of any kind.
- No data leaves your machine except requests to the NaN Dashboard API with your own session.
- No cookies, session payloads, credentials, or raw diagnostics are written to logs, Stream Deck UI, or error messages.
- No automatic background acquisition: a session is imported only after an explicit user click.

## Storage and removal

The imported session lives in your macOS Keychain and can be removed by uninstalling the plugin or resetting the session from the plugin UI. No data is stored on any Refactor IA server.

## Contact

Open an issue at <https://github.com/refactor-ia/streamdeck-nan/issues> for privacy questions or reports. See also [SECURITY.md](SECURITY.md).
