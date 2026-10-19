# Automated quality and release gates

Every push and pull request runs [CI](../.github/workflows/ci.yml), including
documentation-only changes. The same [reusable quality suite](../.github/workflows/quality.yml)
runs again on release tags. There are no skipped-test overrides, success-on-retry
policies, path filters or `continue-on-error` test steps.

## Required checks

| Job | Runs | Evidence |
| --- | --- | --- |
| Web and Chromium acceptance | Locked npm install, unit tests, TypeScript/build, headless Chromium | JUnit, HTML report, failed-test screenshot/video/trace, JSON acceptance attachments |
| Protocol and Windows host | Python contracts/release-policy checks, CMake/CTest C++ protocol checks, Rust formatting and workspace tests | Actions step logs |
| ESP32-S3 public firmware | Pinned ESP-IDF v6.1 image, N16R8 public build, merged-image packaging and extracted readback | Firmware ZIP and manifest |
| Windows x64 application and installer | Tauri production binary and NSIS using the exact browser-tested frontend | Portable ZIP and installer |
| Quality gate | Requires all four jobs to report `success` | Failure, cancellation, skipped or absent result blocks the gate |

Browser checks use the production React components and Web Serial backend with a
virtual serial transport. Storage tests write to **real Chromium OPFS**, close and
reopen files and independently verify sizes and SHA256. Six application scenarios
cover cancellation, disconnect/reconnect, failed port cleanup, corruption and
receipt publication. The production build is also checked for a disconnected
start with no hardware request. Each browser test fails on uncaught exceptions
or console errors. Retries are disabled so a flaky first result stays visible.

Reports are retained for 14 days. OPFS is isolated in a fresh disposable browser
context; tests never select a physical serial port or request a Windows folder.
These checks do not replace the [physical/native acceptance gates](web-qualification.md).

The motion checks also exercise expanding waves, transfer tempo, disconnect,
pause/resume, keyboard controls, runtime reduced motion, localized labels,
device disappearance and a 390px layout. Visibility-event injection checks
background pause logic; actual OS suspension remains a hardware-session check.

First hosted acceptance: [CI run 39235593497](https://github.com/tianrking/AirBridge/actions/runs/39235593497)
passed all three jobs for `02dfedd`. It ran 83 frontend unit tests, the initial
three browser tests, 26 Python tests, 19 Rust tests and 346 C++ protocol checks.
The motion, browser-access and localization extensions bring the suite to 103 frontend
unit tests and 38 browser tests. The five-language/two-theme matrix checks desktop
and mobile layouts, readable controls, computed text contrast, permission denial,
RTL inspectors and preference persistence; its screenshots are included in the
report. See [locale and theme acceptance](localization-and-appearance.md). The additional motion checks exercise reversible
departure, interpolated ring progress, selection, unknown progress, phase-preserving
wave tempo and pause retention across navigation/reload.

## Release behavior

Push a version tag such as `v0.0.1` only when intentionally publishing. Root
`VERSION`, npm/lockfiles, Cargo/lockfile, Tauri and firmware agree or CI fails.
The reusable suite produces a tested web artifact, a pinned ESP-IDF v6.1 firmware
ZIP and Windows x64 installer/portable ZIP. The desktop reuses those exact web
assets instead of rebuilding them. The public firmware contains no private peer,
shared TLS key or NVS image; it generates a per-board identity on first boot.

Release assembly requires all four deliverables from the same workflow/source
commit. Archive manifests cover every file, with sizes and SHA256; archives are
reopened and the flashing helper runs in verify-only mode. Missing/ambiguous
components, tampered bytes and version/source drift block publication. The final
job verifies `SHA256SUMS` again and creates a **prerelease** with the firmware ZIP,
Windows portable ZIP, Windows installer, web ZIP and aggregate manifest/checksums.
Only that job receives `contents: write`. Actions and the ESP-IDF container are
pinned to immutable revisions. PRs cannot publish and no manual bypass is included.

Python policy checks execute the actual four-result gate with every individual
failure, cancellation, skip and absent result. Browser tests also exercise the
public demo in all five languages while throwing on any real serial/file request.
The desktop is unsigned. Actual physical flashing, first-boot identity, RF/native
AirDrop interoperability, installer UX on a clean Windows system and browser
folder-picker/native transfer remain separate manual qualification gates.
[Release notes](release-notes-v0.0.1.md) state these boundaries. Owners can still
publish outside Actions; repository-wide protection settings are separate.

Successful ordinary `main` commits now update [GitHub Pages](pages.md) after the
same complete quality gate. PRs and other refs cannot deploy. The Pages job uses
the exact tested artifact, verifies the current main SHA and publishes a public
source/asset-hash manifest. Version-tag ZIP releases remain a separate workflow.

## Reproduce locally without hardware

```sh
cd desktop
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

On Linux, use `npx playwright install --with-deps chromium`. From the repository root:

```sh
python -m pip install -r scripts/requirements-test.txt
python -m unittest discover -s tests -p 'test_*.py' -v
cmake -S . -B work/ci
cmake --build work/ci --config Release
ctest --test-dir work/ci -C Release --output-on-failure
cargo test --manifest-path desktop/Cargo.toml --workspace --locked
```

The full desktop Rust workspace targets Windows and needs its normal Tauri build
prerequisites. Browser tests own dedicated loopback ports 1430 and 1431 and do not
reuse or disturb the user's running port 1420 development session.

Implementation follows the official [Playwright CI setup](https://playwright.dev/docs/ci)
and [GitHub reusable-workflow model](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows).
