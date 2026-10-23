# Gate 1 evidence: macOS Developer ID signing and notarization

Issue: #14 (revisit macOS signing and notarization, deferred from #4).
Status: **evidence retrieval complete** — no design decision has been made yet; this document records only retrieved official sources, retrieval dates, and local tool state.

## Retrieval record

| Source | URL | Retrieved | Verbatim role |
| --- | --- | --- | --- |
| Apple — Developer ID certificates (Account Help) | https://developer.apple.com/help/account/certificates/developer-id-certificates | 2026-10-23 | Certificate issuance, roles, limits |
| Apple — Customizing the notarization workflow | https://developer.apple.com/documentation/security/customizing-the-notarization-workflow (via https://sosumi.ai/documentation/security/customizing-the-notarization-workflow) | 2026-10-23 | notarytool workflow, stapling |
| Apple — Signing Mac Software with Developer ID | https://developer.apple.com/developer-id/ | 2026-10-23 | Hardened runtime, entitlements |
| Apple TN2206 — macOS Code Signing In Depth | https://developer.apple.com/library/archive/technotes/tn2206/_index.html | 2026-10-23 | Nested code signing order |
| Elgato — Distribution (Stream Deck SDK) | https://docs.elgato.com/streamdeck/sdk/introduction/distribution | 2026-10-23 | Packaging, DRM, Marketplace |
| Elgato — streamdeck pack (CLI) | https://docs.elgato.com/streamdeck/cli/commands/pack | 2026-10-23 | Packaging command |

Retrieval tool: `fetch_content` (direct HTTP + readable extraction), run from the maintainer Pi session.

## Local tool state (observed 2026-10-23)

| Item | Value |
| --- | --- |
| Apple Developer Program | Active subscription confirmed by maintainer (2026-10-14, issue #14 comment thread) |
| Developer ID Application certificate | Present in local keychain: `Developer ID Application: JUAN ENRIQUE BARBAT DEMONTEL (85FKRR9269)` |
| `xcrun notarytool` | 1.1.3 (42) |
| Xcode | 27.1 |
| `@elgato/streamdeck` | `^2.0.0` (package.json) — meets Elgato DRM prerequisite (v2+) |
| Native helper | `native/` builds the `nan-keychain` helper embedded in `com.refactor-ia.nan.sdPlugin` |

Not yet verified locally: App Store Connect API key existence, CI-side certificate import method, clean-machine Gatekeeper behavior.

## Apple facts (gate-relevant)

1. **Certificate**: Developer ID Application signs Mac software distributed outside the Mac App Store. Up to five Developer ID Application certificates per account; creation requires the Account Holder role. Gatekeeper evaluates the certificate at install; apps keep running after the certificate expires — a new cert is only needed for new signatures.
2. **Notarization upload**: `altool` is deprecated (no longer supported since 2023-11-01). Use `xcrun notarytool submit <file> --wait` with one of: App Store Connect API key (`--key <p8> --key-id <id> --issuer <uuid>`) or a keychain profile created once via `xcrun notarytool store-credentials`.
3. **Accepted containers**: ZIP archives (via `ditto -c -k --keepParent`), UDIF disk images, signed flat installer packages. The notary service produces tickets for the top-level file **and each nested signed file**.
4. **Stapling**: `xcrun stapler staple <item>`. You **cannot staple a ZIP archive** or a standalone binary — you staple bundles, apps, disk images, or installer packages. For ZIP distribution: staple each item first, then re-zip. Gatekeeper also finds tickets online at first launch, so stapling is resilience, not the only path.
5. **Nested code order (TN2206)**: signatures record nested code recursively; all nested code must be signed correctly **before** the outer bundle is signed. Sign inside-out: helper executables first, then the enclosing bundle.
6. **Hardened runtime**: Developer ID distribution expects hardened runtime enabled; entitlements must be declared for the functions used.
7. **Fail behavior**: `notarytool log <submission-id>` downloads a JSON log enumerating errors/warnings; always check it even on success.

## Elgato facts (gate-relevant)

1. Plugins are packaged with `streamdeck pack` into a `.streamDeckPlugin` installer file; the CLI validates first.
2. Elgato documents **no Apple signing or notarization requirement** anywhere in the distribution path; Marketplace review concerns product media and metadata. Distribution to users is the `.streamDeckPlugin` file itself.
3. **DRM** (CLI 1.6+, SDK v2+): after Maker Console upload, Elgato encrypts files and adds integrity checking. Consequences for signing work: distributed files are immutable, and the manifest must not be read at runtime. Our plugin already meets SDK v2.
4. The plugin binary and the embedded `nan-keychain` helper are plain executables loaded by the Stream Deck app on the user's machine — this is exactly the case Apple's "notarize plug-ins for other software packages" and unsigned-executable Gatekeeper friction apply to.

## Consequences for the design (not yet decided)

- The container we distribute (`.streamDeckPlugin`) is a custom package, not a staplable format. The working shape is: sign helper + plugin executable inside-out → notarize → staple what is staplable → package → verify final bytes + checksums. Whether the packaged result still passes Stream Deck validation after stapling is an open question to resolve in gate 3.
- Notarytool authentication should use the App Store Connect API key in CI secrets (not app-specific passwords), keeping PR CI credential-free per the issue's non-goals.
- Signed distribution is a **new release version**; published unsigned assets are never replaced.

## Next gate

Gate 3 (implementation design) per issue #14: CI secret layout, sign/notarize/staple/pack script order, reproducibility checks before signing and final-byte checksums after, and validation on clean macOS. This document is the only thing gate 1 delivers; no code changes are made on this branch.
