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
| Quality gate | Requires both jobs to report `success` | Failure, cancellation, skipped or absent result blocks the gate |

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
pause/resume, keyboard controls, runtime reduced motion, three-language labels,
device disappearance and a 390px layout. Visibility-event injection checks
background pause logic; actual OS suspension remains a hardware-session check.

First hosted acceptance: [CI run 39235593497](https://github.com/tianrking/AirBridge/actions/runs/39235593497)
passed all three jobs for `02dfedd`. It ran 83 frontend unit tests, the initial
three browser tests, 26 Python tests, 19 Rust tests and 346 C++ protocol checks.
The current motion extension brings the browser suite to seven tests.

## Release behavior

Push a version tag such as `v0.4.0` **only when intentionally publishing a release**.
The tag must exactly match `desktop/package.json`. The workflow checks the tagged
source, runs every suite, downloads the exact tested web build, packages it with
a per-file SHA256 manifest, reopens/verifies the ZIP, and verifies its archive
checksum again immediately before creating the GitHub release. Only the final
publish job receives `contents: write`; checks and packaging are read-only.
Third-party actions are pinned to full commit SHAs. Pull requests do not receive
release permissions, and `pull_request_target` is not used.

Any failed, cancelled or skipped required suite prevents both packaging and
publishing. Package failure blocks publishing too. Python regression tests inspect
these dependencies, exercise all 25 pairs of gate outcomes with the actual gate
shell commands, and reject version drift or incomplete build assets.

This workflow publishes a **static browser package** with no installer or firmware
binary. The retained Tauri code is compiled/tested; native app signing and firmware
release qualification remain separate. Owners can still publish manually outside
Actions; repository-wide branch/tag protections are separate GitHub settings.
No release is created merely by pushing an ordinary commit.

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
