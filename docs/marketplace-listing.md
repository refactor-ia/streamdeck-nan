# Marketplace Listing — draft copy (Maker Console)

Working copy for the Elgato Maker Console submission. Final fields are entered in the portal; this file is the source of truth for wording. Verify the portal's exact field list and review checklist before submitting (issue #15).

## Plugin name

NaN Dashboard

## Tagline (short)

Track your NaN AI usage on Stream Deck.

## Description (long)

NaN Dashboard brings your NaN AI usage to Stream Deck. See your remaining quota on a Stream Deck+ dial, or put NaN actions on standard keys: model consumption, total tokens and month-to-date tokens.

- **NaN Usage dial (Stream Deck+):** rotate/touch to refresh your quota; high-contrast warning levels when you run low.
- **NaN Model Usage / Total Tokens / Monthly Tokens (Stream Deck & Stream Deck+):** live keypad tiles that refresh automatically.
- **Secure session import:** click **Import session from Chrome** once in the action's configuration panel; your session is validated and stored in the macOS Keychain. Nothing is sent anywhere except the NaN Dashboard API, with your own session.
- **Bonus monitors (no NaN account needed):** Claude Code usage and OpenAI Codex usage dials. A Grok monitor is experimental.

Requires macOS 13+ and the Stream Deck 7.1+ app. NaN account and Chrome required for NaN actions. The plugin is open source: <https://github.com/refactor-ia/streamdeck-nan>.

## Keywords / search terms

NaN, AI usage, quota, tokens, Claude, Codex, Grok, Stream Deck+

## Listing assets (upload to Maker Console)

| Asset | Source | Status |
| --- | --- | --- |
| App icon (1024×1024) | Render at upload time from `design-assets/nan-brand/source/nan-isotipo-color.svg` | Source of truth in repo |
| Gallery screenshots | Real Stream Deck+ dial + keypad captures showing quota states | TODO: capture on hardware |
| Category icon (in-manifest, white mono SVG) | `imgs/plugin/nan-category.svg` | Done |
| Action icons (in-manifest, white mono SVG) | `imgs/actions/nan-usage/nan-usage.svg` for the dial | Done (Grok keeps shared icon, deferred) |

## Privacy / support URLs

- Privacy policy: host `PRIVACY.md` and provide its public URL (GitHub blob URL is acceptable).
- Support: <https://github.com/refactor-ia/streamdeck-nan/issues>

## Open portal questions (verify at submission)

- Exact review checklist and privacy requirements for plugins that read browser cookies (declare Chrome access explicitly and link the privacy policy).
- Whether unsigned bundles are accepted for review the same way direct distribution is, or whether signing (#14) should land first.
- Screenshot dimensions/format required by the portal.
