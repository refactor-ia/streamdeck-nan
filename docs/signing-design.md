# Gate 3 design: Developer ID signing and notarization for NaN

Issue: #14. Builds on `docs/signing-evidence.md` (gate 1). This document is the **design**; no implementation is made on this branch.

## What actually needs signing

The plugin is Node.js code executed by Stream Deck's own (Elgato-signed) host — the plugin JavaScript is not a Mach-O and needs no signature. Exactly one Mach-O exists in the bundle:

- `com.refactor-ia.nan.sdPlugin/bin/nan-keychain` — the Swift helper (arm64 + x86_64 via lipo).

Design consequence: **the only artifact to sign is the helper.** The plugin bundle gets a notarization ticket for the signed helper as nested code; there is nothing else to seal.

## Signing step (build-nan-keychain.mjs)

After lipo produces `bin/nan-keychain`, an optional signing step runs when `SIGN_IDENTITY` is set:

```
codesign --force --options runtime --timestamp=none --sign "$SIGN_IDENTITY" bin/nan-keychain
```

- `--options runtime`: hardened runtime, required for Developer ID distribution.
- `--timestamp=none`: signing without an online TSA keeps the build deterministic, preserving the reproducibility contract. The notarization ticket provides the trusted timestamp instead (Apple-verified at notary time).
- No entitlements on first pass: the helper already runs successfully unsigned; request entitlements only if notarization validation or runtime requires them.
- Without `SIGN_IDENTITY` the build is unchanged — every existing test and CI run keeps passing unsigned (per issue non-goals: PR CI stays credential-free).

Notarization requires the code signature to be **inside-out**; the helper is a single-file tool so there is only one level — signed directly.

## Where signing happens in CI

- `ci.yml` (PRs): unchanged. No secrets, no signing, unsigned reproducibility checks still pass.
- `release.yml` `package` job: unchanged (no permissions, per existing contract tests).
- `release.yml` `publish` job (macOS runner, the only job with restricted secrets):

| Secret | Content |
| --- | --- |
| `APPLE_AC_API_KEY_P8` | App Store Connect API key (.p8, base64-decoded to a temp file) |
| `APPLE_AC_KEY_ID` | Key ID |
| `APPLE_AC_ISSUER` | Issuer UUID |
| `SIGN_IDENTITY` | `Developer ID Application: JUAN ENRIQUE BARBAT DEMONTEL (85FKRR9269)` |

## Notarization and stapling (publish job)

The `.streamDeckPlugin` file is a custom ZIP container: **not a staplable format** (gate 1 finding). Therefore:

1. Build helper signed (publish job only: `SIGN_IDENTITY` present), pack via `release:pack` as today.
2. Create the notarization container from the staging directory:

   ```
   ditto -c -k --keepParent com.refactor-ia.nan.sdPlugin nan-notarize.zip
   ```

3. Submit and wait:

   ```
   xcrun notarytool submit nan-notarize.zip --key <p8> --key-id <id> --issuer <uuid> --wait
   ```

   The notary service produces a ticket for the `.sdPlugin` bundle **and for the signed `nan-keychain`** nested inside (gate 1: tickets cover nested signed files).
4. `notarytool log <submission-id>` is always fetched and archived with the release even on success (gate 1: warnings must be read).
5. **Stapling is skipped by design**: a ZIP cannot be stapled (gate 1), the shipped `.streamDeckPlugin` is not a bundle, and standalone binaries cannot carry stapled tickets. Gatekeeper resolves the ticket online at first launch, which covers the helper. This is recorded as an accepted trade-off, not an omission.
6. Fail closed: any notarytool non-zero exit or `status: Invalid` fails the publish job — no partially notarized release ships.
7. After a successful notarization, re-run `release:pack` (already-signed helper) and publish **as a new release version**. Published unsigned assets are never replaced (issue non-goal).

## Reproducibility contract

- The unsigned reproducibility check (`release:pack:verify`) remains the pinned contract and keeps passing bit-for-bit — it runs in CI where signing is off.
- The signed variant is exempted from byte-identity with the unsigned one: `codesign` embeds a CMS signature, and the contract test documents that the *unsigned* path is what reproducibility pins. A follow-up test asserts that signing with `--timestamp=none` yields byte-identical output across two runs on the same machine; if that proves false, the reproducibility check is documented as unsigned-only explicitly.

## Validation gate (before first signed release)

1. `streamdeck validate` on the signed `.sdPlugin` staging copy and on the final packaged result.
2. Clean macOS (both architectures): install via the `.streamDeckPlugin`, confirm no Gatekeeper warning on `nan-keychain`, confirm helper functionality (keychain store/read).
3. `codesign --verify --strict` and `spctl --assess` on the helper inside an extracted bundle.
4. Confirm DRM integrity still holds: files under `bin/` are immutable after packaging (Elgato DRM prerequisite).

## Explicitly out of scope

- Notarizing the CI runners or the collector; this covers the plugin bundle only.
- Any change to how `nan-keychain` works at runtime; signing is metadata, not behavior.
- Re-signing already-published releases.

## Open decision for the maintainer

The only deliberate choice to confirm before implementation: **sign with `--timestamp=none` for determinism** (recommended; ticket provides timestamp) vs `--timestamp` with TSA (stronger per-signature timestamp but breaks byte-reproducibility). Default recommendation: `--timestamp=none`.
