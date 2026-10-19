# Languages and appearance

The Web Serial and retained Tauri applications share the same React interface,
locale dictionaries and semantic colors. Open **Settings → Language** to change
language, or **Settings → Appearance** to choose Light, Dark or System.
Changing either preference does not reconnect the bridge, restart its radio,
reset a selected file or cancel an active transfer.

| Language | Identifier | Reading direction |
| --- | --- | --- |
| English — default | `en` | Left to right |
| Español | `es` | Left to right |
| Français | `fr` | Left to right |
| 繁體中文 | `zh-Hant` | Left to right |
| العربية | `ar` | Right to left |

English is the initial language even when the browser uses another locale.
An explicit selection is saved locally as `airbridge.language.v1`. Missing,
invalid or inaccessible preference storage returns to English. The interface
still allows changes when the browser denies storage; those changes simply
cannot survive a reload.

Appearance defaults to **System** and responds to operating-system color-scheme
changes. An explicit Light or Dark choice takes precedence until System is
selected again. The choice is stored as `airbridge.theme.v1`. Color-scheme changes
are independent of the remembered animation pause and system reduced-motion
setting. No online fonts or runtime translation services are loaded.

## Message architecture

- [`locales/registry.ts`](../desktop/src/locales/registry.ts) is the single list
  of supported identifiers, native language names and directions. `Language`
  derives from this list.
- Each file in [`locales/`](../desktop/src/locales/) contains `ui`, `web`,
  `access` and `files` namespaces. These cover navigation, settings, discovery,
  transfer states, inspectors, browser support, permissions and file-count forms.
- English defines the message schema. Every other dictionary uses
  `satisfies LocaleMessages`; missing or extra fields fail the TypeScript build.
  There is no spread of English messages or silent untranslated-key fallback.
- [`i18n.ts`](../desktop/src/i18n.ts) provides typed message lookup, validated
  preference loading and `Intl.PluralRules` file counts. Arabic supplies all six
  plural categories. Numeric formatting explicitly selects Arabic-Indic digits
  for Arabic so different CLDR/runtime defaults do not change this product's
  presentation. Dates use the selected language; technical byte units remain
  `B`, `KiB` and `MiB`.
- [`usePreferences.ts`](../desktop/src/usePreferences.ts) owns the language,
  theme and system-scheme subscription. It removes the media-query listener on
  unmount and updates document direction and scheme before React paints.

To add a locale, register it, create a complete typed dictionary and add it to
the central message map. The contract tests and browser matrix enumerate the
registry, so a registered language cannot silently miss browser coverage.

## RTL and technical data

Arabic sets both `lang="ar"` and `dir="rtl"` on the document. Navigation, spacing,
form controls, detail alignment and close controls use logical positioning.
Geometric wave origins, physical FLIP measurements and circular progress are
unchanged, preserving the discovery motion system in either direction.

Device names, filenames and directory paths retain their original text. Unknown
text direction is isolated with `bdi`/`dir="auto"`; copyable MAC addresses and
SHA256 values use explicit LTR isolation. Copying therefore returns the original
value, independent of the surrounding interface language.

Protocol identifiers, hardware product names, receipt/export schemas and raw
diagnostic messages are not translated. Curated status, explanations and
permission-recovery guidance are translated. Native OS file/permission dialogs
are drawn by the browser or operating system and follow its language settings.

## Theme architecture

[`theme.css`](../desktop/src/theme.css) defines semantic surface, text, border,
accent, success, warning, disabled and focus colors. Components consume these
tokens; radio gradients, selected devices, native modal backdrops and progress
indicators receive scheme-specific treatment. Arabic uses a local font stack and
normal letter spacing to preserve connected glyphs.

## Automated acceptance

`npm test` checks complete message paths, nonempty Unicode strings, plural forms,
localized bytes, validated preferences, denied storage and explicit/system
appearance precedence. `npm run test:browser` checks:

- All **five languages × two explicit themes**, with 1440px and 390px layouts.
- Actual production navigation, language/theme controls, persistence after
  reload, receive-folder guidance and localized permission-denial recovery.
- No horizontal overflow or clipped setting labels; computed muted text contrast
  against the setting-card background is at least **4.5:1** in each combination.
- The production device and checked-receive dialogs using clearly disclosed,
  development-only synthetic data, including LTR MAC/SHA256 rendering in Arabic.
- Dynamic system-scheme changes, explicit overrides, animation-pause retention,
  invalid preferences and a browser that denies access to `localStorage`.

Each matrix case attaches desktop/mobile and checked-receive PNGs to the
Playwright report. All browser tests reject console errors and uncaught browser
exceptions. The existing [CI quality gate](continuous-delivery.md) automatically
runs these tests before Pages or version-tag publication. No hardware is opened
by these tests; they do not qualify new physical serial or AirDrop transfers.

Platform behavior follows the browser references for
[`dir` and bidi isolation](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/dir),
[`Intl.PluralRules`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules)
and [`prefers-color-scheme`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-color-scheme).
