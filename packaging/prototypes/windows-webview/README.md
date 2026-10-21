# Windows WebView2 prototype

This isolated prototype loads the current `src` tree into WebView2 under `https://recap-page-prototype.invalid`. It does not start Node, bind a socket, change the production launcher, or share a browser profile. The first-party state remains in WebView2's dedicated `%LOCALAPPDATA%\RecapPageWebViewPrototype\UserData` folder. Keep synthetic data in this profile.

The build recipe uses the preinstalled Windows SDK `10.0.28000.0` and the cached `Microsoft.Web.WebView2` NuGet package `1.0.4078.44`. `prototype.json` pins the package URL and SHA-512. The build checks the local package hash and fails rather than downloading missing prerequisites. Build outputs, copied app assets, generated configuration, runtime observations and profile data stay under `out` or the dedicated local application data directory and are not source artifacts.

From the repository root, the exact build command is:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\packaging\prototypes\windows-webview\build.ps1 -Architecture ARM64
```

The exact native test invocation is:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\packaging\prototypes\windows-webview\run-native.ps1 -Architecture ARM64
```

The runner opens the shell, samples TCP listeners owned by the shell process tree while it is open, and writes the observations to the scratch `out` directory. During that one composed native journey, use only synthetic entries: change a reading mark, add a deferral or rating, create an import draft, close and reopen the shell, and verify the data remains. Export the reading-data, completion-history and import-draft backups separately through the native save dialog; cancel one save and confirm no file is reported as saved. Try an invalid restore in the disposable prototype profile and confirm the app leaves its current data unchanged. The test runner does not auto-skip when the runtime, SDK or compiler is unavailable.

Reader launch remains a separate native window until the existing same-origin launch page finishes resolving its metadata. Only HTTPS `marvel.com`, `www.marvel.com` and `read.marvel.com` destinations are dispatched through Windows to the default browser. The authenticated reader is never embedded or given the WebView2 profile. Popup or shell failures are reported; reader launch does not mark an issue read. Other external navigation is denied.

The response handler serves only files rooted under the derived asset directory, rejects traversal and reparse-point files, sets MIME and security headers, and gives missing or invalid paths explicit error responses. External comic images are blocked by CSP so the prototype cannot persist them in its WebView cache. The interface will therefore not display remote cover art in this prototype. Metadata API requests remain credential-free and optional. No host objects or native script bridge are exposed.

## Verification observations

The ARM64 prototype built successfully with MSVC 14.44.35207, Windows SDK 10.0.28000.0 and cached WebView2 SDK 1.0.4078.44. The runner completed with exit code 0 and sampled the prototype process tree 417 times; every sample reported zero TCP listeners. The synthetic `My Reading List` and read state remained present after closing and reopening the prototype. The reading-data, completion-history and retained import-draft backups were saved under `out`; the reading-data export contains only the synthetic manual issue.

The four hermetic contract tests passed. A targeted mutation that rejected approved reader hosts made the matching test fail as expected, then the implementation was restored. Invalid restore behavior, a cancelled export, and native reader handoff remain unverified. The synthetic manual issue has no reader identifier or reader URL, so no real reader destination was opened. x64 build and runtime coverage remain untested. These results do not assert accessibility certification, a real subscription result, Store packaging, signing, or production suitability.
