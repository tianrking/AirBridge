# AirBridge on GitHub Pages

Open **[AirBridge Web](https://w0x7ce.eu/AirBridge/)** directly in current desktop
Chrome or Edge. The project inherits the account's existing Pages domain.
HTTPS is enforced and the domain certificate is approved. No desktop app or
local web server is required to open the interface. A compatible ESP32-S3 with
the browser-capable firmware is still required for real AirDrop use.

## Automatic deployment

Every push and pull request runs the complete [quality suite](continuous-delivery.md).
Only successful checks on `main` can prepare or deploy a Pages artifact. PRs,
other branches, version tags, failed/cancelled checks and skipped quality jobs
cannot update the site. A manual CI run on `main` uses the same checks and gate.

The deployment downloads the exact `tested-web` artifact from that same workflow
run; it does not rebuild the frontend. The preparation step rejects root-relative
entry assets, missing assets, symlinks and files outside the production allowlist.
Only the final deployment job has `pages: write` and `id-token: write`, with the
`github-pages` environment and serialized deployments. It checks the current
`main` SHA before publishing so a superseded run cannot overwrite newer source.

`build-info.json` records the source commit, workflow URL and the byte count/SHA256
of each published build file. This metadata contains no serial logs, files,
credentials or device observations. It allows independent verification of which
source is live and whether the assets match the checked artifact.

## Browser access and permission model

- Use HTTPS in a full desktop Chrome or Edge tab. API feature detection, rather
  than user-agent guessing, determines whether serial and folder access exist.
  Safari, Firefox and mobile browsers do not expose the full required API set.
- Embedded previews show an explicit full-page link. Insecure origins, denied
  `Permissions-Policy`, missing Web Serial or missing file pickers block
  connection and show localized recovery instructions.
- Capability availability **does not mean permission is granted**. Choose a
  receive folder first, allow read/write access, then click Connect and select
  the bridge. Only those user actions open permission prompts. No serial devices
  are enumerated or opened on page load.
- Browser choosers do not display Windows COM numbers. The existing USB filter
  and firmware factory-identity handshake still protect the configured board;
  use Device Manager to correlate ports if necessary. The site does not flash
  hardware or bypass that identity check.
- A dismissed chooser can be retried. Permission-denied errors preserve a
  disconnected state and show site-permission guidance. Folder handles are
  selected again for a new session; the app does not silently assume persistent
  permission or write access to Downloads.
- Keep the tab open and computer awake while transferring. Release the port in
  Tauri, flash tools or other monitors before connecting from the browser.

File payloads stay on the browser/serial/radio path. GitHub Pages serves static
assets; there is no AirBridge file-upload endpoint, analytics or account system.
GitHub Pages does not provide arbitrary custom response headers, so the UI also
checks secure context, top-level browsing and the browser's effective serial
policy. A `Permissions-Policy` HTTP header is not emulated with an ineffective
HTML meta tag.

## Default motion

The **production page itself** animates by default, with soft moving blue/lilac
light and breathing concentric layers before connection. This is ambient
decoration; the live status remains Disconnected and there are no fake peers.
Connected discovery adds propagating signal rings; active transfers increase
their tempo. The same interface and motion remain available in Tauri.

The pause/resume control works even before connecting. Background tabs pause
decorative motion, and the system's reduced-motion preference disables it.
Animations use CSS transforms and opacity, without a JavaScript frame loop.

Browser automation covers the production disconnected animation, capability
and permission failures, an actual denying policy header, embedded previews,
chooser rejection, wave state changes, keyboard controls and reduced motion.
Serial and native AirDrop acceptance remain separate hardware gates; publishing
the website does not requalify those links.

References: [GitHub Pages workflow setup](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages),
[Chrome Web Serial permissions](https://developer.chrome.com/docs/capabilities/serial).
