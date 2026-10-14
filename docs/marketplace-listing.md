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
- **Secure API key:** paste your NaN API key once in the action's configuration panel; it is stored in the macOS Keychain. Nothing is sent anywhere except NaN, with your own key.
- **Bonus monitors (no NaN account needed):** Claude Code usage and OpenAI Codex usage dials. A Grok monitor is experimental.

Requires macOS 13+ and the Stream Deck 7.1+ app. NaN account and API key required for NaN actions. The plugin is open source: <https://github.com/refactor-ia/streamdeck-nan>.

## Keywords / search terms

NaN, AI usage, quota, tokens, Claude, Codex, Grok, Stream Deck+

## Listing assets (upload to Maker Console)

| Asset | Source | Status |
| --- | --- | --- |
| App icon (1024×1024) | Render at upload time from `design-assets/nan-brand/source/nan-isotipo-color.svg` | Source of truth in repo |
| Gallery (upload in this order) | `docs/gallery/nan-hardware-hero.png`, `nan-hardware-desk.png` (hardware photos), then `nan-dashboard-overview.png`, `nan-usage-detail.png`, `nan-setup.png` (app compositions), then the demo MP4 (1920×1080) | Photos done 2026-09-16 |
| Demo video | Short screen + hardware recording: add action, save API key, dial/keys update, touch to refresh. Emailed to maker@elgato.com | Sent 2026-09-16 |
| Category icon (in-manifest, white mono SVG) | `imgs/plugin/nan-category.svg` | Done |
| Action icons (in-manifest, white mono SVG) | `imgs/actions/*/**.svg`, one per action on the 100×100 grid; the dashboard launcher keeps its PNG isotype | Done |

## Privacy / support URLs

- Privacy policy: host `PRIVACY.md` and provide its public URL (GitHub blob URL is acceptable).
- Support: <https://github.com/refactor-ia/streamdeck-nan/issues>

## SDK 3 and DRM (resolved 2026-09-11)

The Maker Console rejects submissions with `SDKVersion: 2` and DRM off. Per official docs, DRM requires the official `@elgato/streamdeck` library v2+ (we bundle 2.1.0), `SDKVersion: 3`, and `Software.MinimumVersion` 6.9+ (ours is 7.1). The manifest now declares `SDKVersion: 3`; DRM activation happens portal-side after upload and processing. DRM applies to the Marketplace copy; the GitHub-release `.streamDeckPlugin` remains unprotected by design.

## Open portal questions (verify at submission)

- Exact review checklist and privacy requirements for plugins that store a user API key (link the privacy policy).
- Whether unsigned bundles are accepted for review the same way direct distribution is, or whether signing (#14) should land first.
- Screenshot dimensions/format required by the portal.

## Review round 1 (2026-09-16, v1.0.11) — requires changes

Feedback: (1) update product-page media to better showcase the product (reference: Elgato Volume Controller page and the gallery guidelines); (2) email a short demo video to maker@elgato.com so functionality can be verified. No technical objection was raised. Response: hardware photos added as the first two gallery items; demo video already emailed; resubmit the same version via Products → Versions.
