# Privacy Policy — NaN Dashboard for Stream Deck

_Last updated: 2026-09-11. Applies to the NaN Dashboard Stream Deck plugin by Refactor IA._

## What the plugin accesses

- **Your NaN API key.** When you paste it and click **Save API key** in a NaN action's configuration panel, the plugin stores it in the macOS Keychain. It never reads browser data, saved passwords, or browsing history.
- **macOS Keychain.** The key lives in the plugin's own Keychain item. Keychain prompts come from macOS.
- **NaN API.** With your key, the plugin queries fixed NaN endpoints to display your own quota, model usage and token totals. All requests originate from your machine.

## What we do NOT do

- No telemetry, analytics, crash reporting, or tracking of any kind.
- No data leaves your machine except requests to NaN with your own API key.
- Your API key is never written to Stream Deck settings, logs, Stream Deck UI, or error messages.
- No automatic acquisition: a key is stored only after you explicitly click **Save API key**.

## Storage and removal

The key lives in your macOS Keychain and can be removed with **Remove key** in the plugin UI or by uninstalling the plugin. No data is stored on any Refactor IA server.

## Contact

Open an issue at <https://github.com/refactor-ia/streamdeck-nan/issues> for privacy questions or reports. See also [SECURITY.md](SECURITY.md).
