// Hosted-runner measurement for #1412: installing a browser app creates per-user Start and
// uninstall registrations, so this never runs on a reader's machine. It records where Edge and
// Chrome put the installed app's shortcut, which app id they derive for the fixed origin, and
// which launch routes open a standalone window in the same profile. It also measures what a shortcut left
// behind by an uninstalled app opens, and, with MRT_PWA_PACKAGE=installed, what the installed test package
// opens through the runner's own Default Edge profile, where a policy install stands in for the reader's.
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createStaticServer, DEFAULT_PORT as PORT, HOST } from '../server.mjs';
import {
  APP_ID, APP_WINDOW_URL, findInstalls, matchProxy, openAppWindow, parseShortcut, readArguments, readDefaultBrowser,
  resolveAppWindow,
} from '../host/appWindow.mjs';
import { STARTUP_API_HEADER, STARTUP_API_PREFIX } from '../host/startupTask.mjs';
import { AUMID, PACKAGE_FAMILY, PACKAGE_NAME } from './pack-msix.mjs';

if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true') {
  console.error('windows-pwa-probe installs real apps and runs only on a hosted Windows runner.');
  process.exit(2);
}

const driver = join(process.env.MRT_PUPPETEER, 'node_modules', 'puppeteer-core', 'lib', 'puppeteer', 'puppeteer-core.js');
const { default: puppeteer } = await import(pathToFileURL(driver).href);
const evidence = process.env.MRT_PWA_EVIDENCE || join(tmpdir(), 'recap-pwa-probe');
await mkdir(evidence, { recursive: true });

const origin = `http://${HOST}:${PORT}`;
const manifestId = `${origin}/`;
const predictedAppId = [...createHash('sha256').update(manifestId).digest().subarray(0, 16)]
  .map((byte) => String.fromCharCode(97 + (byte >> 4)) + String.fromCharCode(97 + (byte & 15))).join('');

const browsers = [
  { name: 'edge', exe: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', internals: 'edge://web-app-internals', image: 'msedge.exe', proxy: 'msedge_proxy.exe' },
  { name: 'chrome', exe: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', internals: 'chrome://web-app-internals', image: 'chrome.exe', proxy: 'chrome_proxy.exe' },
];

const ps = (command) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `$ErrorActionPreference = 'Stop'; ${command}`], { encoding: 'utf8' }).trim();
const psJson = (command) => {
  const output = ps(`ConvertTo-Json -Depth 4 -Compress -InputObject @(${command})`);
  return output ? JSON.parse(output) : [];
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function links(since) {
  return psJson(`
    $shell = New-Object -ComObject WScript.Shell;
    $app = New-Object -ComObject Shell.Application;
    $roots = @('Programs', 'CommonPrograms', 'Desktop', 'CommonDesktopDirectory') | ForEach-Object {
      [PSCustomObject]@{ kind = $_; path = [Environment]::GetFolderPath($_) } };
    foreach ($root in $roots) {
      if (-not $root.path -or -not (Test-Path -LiteralPath $root.path)) { continue }
      Get-ChildItem -LiteralPath $root.path -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTimeUtc -ge [DateTime]::Parse('${since}').ToUniversalTime() -or $_.BaseName -like '*Recap*' } |
        ForEach-Object {
          $link = $shell.CreateShortcut($_.FullName);
          $item = $app.NameSpace($_.DirectoryName).ParseName($_.Name);
          [PSCustomObject]@{
            root = $root.kind; relative = $_.FullName.Substring($root.path.Length); target = $link.TargetPath;
            arguments = $link.Arguments; icon = $link.IconLocation; workingDirectory = $link.WorkingDirectory;
            aumid = $item.ExtendedProperty('System.AppUserModel.ID'); full = $_.FullName;
            bytes = [Convert]::ToBase64String([IO.File]::ReadAllBytes($_.FullName)) }
        }
    }`);
}

const startApps = () => psJson(`Get-StartApps | Where-Object { $_.Name -like '*Recap*' } | Select-Object Name, AppID`);
const uninstallKeys = () => psJson(`Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue |
  ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath } | Where-Object { $_.DisplayName -like '*Recap*' } |
  Select-Object PSChildName, DisplayName, UninstallString, DisplayIcon, Publisher`);
const protocolKeys = () => psJson(`Get-ChildItem 'HKCU:\\Software\\Classes' -ErrorAction SilentlyContinue |
  Where-Object { $_.PSChildName -like 'web+*' -or $_.PSChildName -like '*Recap*' } | Select-Object PSChildName`);
const runKeys = () => psJson(`Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -ErrorAction SilentlyContinue |
  ForEach-Object { $_.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | Select-Object Name, Value }`);

function appxPackage(family) {
  if (!family) return null;
  return psJson(`Get-AppxPackage | Where-Object { $_.PackageFamilyName -eq '${family}' } | ForEach-Object {
    $manifest = [xml](Get-Content -LiteralPath (Join-Path $_.InstallLocation 'AppxManifest.xml') -Raw);
    [PSCustomObject]@{ fullName = $_.PackageFullName; signatureKind = "$($_.SignatureKind)"; installLocation = $_.InstallLocation;
      applications = @($manifest.Package.Applications.Application | ForEach-Object {
        [PSCustomObject]@{ id = $_.Id; executable = $_.Executable; entryPoint = $_.EntryPoint; outer = $_.OuterXml.Substring(0, [Math]::Min(1500, $_.OuterXml.Length)) } }) } }`);
}

function processes(image) {
  return psJson(`Get-CimInstance Win32_Process -Filter "Name='${image}'" | Select-Object ProcessId, ParentProcessId, CommandLine`);
}

// Shortcut arguments quote mid-token (--user-data-dir="C:\..."), so a token-start-only quote
// rule passes the quotes through as part of the path. The first run did that.
function splitArguments(text) {
  const tokens = [];
  let current = '';
  let quoted = false;
  let started = false;
  for (const character of text) {
    if (character === '"') { quoted = !quoted; started = true; continue; }
    if (!quoted && /\s/.test(character)) {
      if (started) tokens.push(current);
      current = '';
      started = false;
      continue;
    }
    current += character;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

const allWindows = () => psJson(`Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object Id, ProcessName, MainWindowTitle`);
const imageProcesses = (images) => images.flatMap((image) => processes(image));
const stopProcess = (id) => { try { process.kill(id); } catch { /* already gone */ } };

async function standaloneTargets(browser, before) {
  const found = [];
  for (const target of browser.targets()) {
    if (before.has(target) || target.type() !== 'page' || !target.url().startsWith(origin)) continue;
    const page = await target.page();
    if (!page) continue;
    const standalone = await page.evaluate('matchMedia("(display-mode: standalone)").matches').catch((error) => `error: ${error.message}`);
    const session = await target.createCDPSession();
    const { windowId } = await session.send('Browser.getWindowForTarget');
    found.push({ url: target.url(), standalone, windowId, page });
  }
  return found;
}

async function warmLaunch(browser, spec, label, launch, tabWindowId) {
  const before = new Set(browser.targets());
  const images = [spec.image, spec.proxy];
  const processesBefore = new Set(imageProcesses(images).map((entry) => entry.ProcessId));
  const windowsBefore = new Set(allWindows().map((entry) => `${entry.Id}:${entry.MainWindowTitle}`));
  let error = null;
  let launched = null;
  try { launched = await launch(); } catch (caught) { error = caught.message; }
  let found = [];
  for (let waited = 0; waited < 20000 && !found.length; waited += 500) {
    await sleep(500);
    found = await standaloneTargets(browser, before);
  }
  const newProcesses = imageProcesses(images).filter((entry) => !processesBefore.has(entry.ProcessId));
  const newWindows = allWindows().filter((entry) => !windowsBefore.has(`${entry.Id}:${entry.MainWindowTitle}`));
  const result = {
    label, error, launched,
    opened: found.map(({ url, standalone, windowId }) => ({ url, standalone, separateWindow: windowId !== tabWindowId })),
    newProcesses: newProcesses.map((entry) => entry.CommandLine), newWindows,
  };
  for (const { page } of found) await page.close().catch(() => {});
  for (const entry of newProcesses) if (!/--type=/.test(entry.CommandLine ?? '')) stopProcess(entry.ProcessId);
  return result;
}

function spawnAndWait(file, args) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const timer = setTimeout(() => resolve({ exit: 'still running after 10 s', args, output: output.slice(0, 2000) }), 10000);
    child.on('error', (failure) => { clearTimeout(timer); resolve({ exit: `spawn error: ${failure.message}`, args }); });
    child.on('exit', (code) => { clearTimeout(timer); resolve({ exit: code, args, output: output.slice(0, 2000) }); });
  });
}

// puppeteer.launch adds --enable-automation, and run 2 measured that an automated browser
// ignores a handed-off --app-id launch unless the same flag is present. A reader's browser
// is never automated, so start it plainly. Run 3 measured that the PWA domain answers only a
// pipe client ("'PWA.install' wasn't found" over a debugging port), so keep the pipe and
// frame its null-terminated messages here instead of letting puppeteer add its flags.
async function startBrowser(spec, profile) {
  const child = spawn(spec.exe, ['--remote-debugging-pipe', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-background-networking', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const [, , , toBrowser, fromBrowser] = child.stdio;
  let pending = '';
  const transport = {
    send(message) { toBrowser.write(`${message}\0`); },
    close() { toBrowser.end(); },
  };
  fromBrowser.setEncoding('utf8');
  fromBrowser.on('data', (chunk) => {
    const parts = (pending + chunk).split('\0');
    pending = parts.pop();
    for (const message of parts) transport.onmessage?.(message);
  });
  fromBrowser.on('close', () => transport.onclose?.());
  toBrowser.on('error', () => {});
  return puppeteer.connect({ transport, defaultViewport: { width: 1280, height: 900 } });
}

// The shipped reader of these shortcuts (#1412), run against what the browser really wrote. This profile is
// a disposable --user-data-dir, which the module must refuse, so the whole-folder answer has to be that
// refusal; with only that switch removed, the same shortcut must read as this app in a named profile
// behind the browser's own proxy, and the module's own .lnk parse must agree with the shell's.
async function moduleView(link) {
  const view = { installs: await findInstalls() };
  if (!link) return { ...view, ok: false, why: 'no shortcut for this app' };
  const parsed = parseShortcut(Buffer.from(link.bytes, 'base64'));
  view.parsedTarget = parsed?.target ?? null;
  view.parsedArguments = parsed?.arguments ?? null;
  const withoutDataDir = (parsed?.arguments ?? '').replace(/"?--user-data-dir=("[^"]*"|[^ ]*)"?\s*/, '').trim();
  view.withoutDataDir = withoutDataDir;
  view.readFull = readArguments(parsed?.arguments ?? '');
  view.readWithoutDataDir = readArguments(withoutDataDir);
  const proxy = parsed ? matchProxy(parsed.target, process.env) : null;
  view.proxy = proxy ? { browser: proxy.browser.name, proxy: proxy.proxy } : null;
  const problems = [];
  if (!parsed) problems.push('shortcut did not parse');
  else {
    if (parsed.target.toLowerCase() !== String(link.target).toLowerCase()) problems.push('target differs from the shell');
    if (parsed.arguments !== link.arguments) problems.push('arguments differ from the shell');
  }
  if (view.installs.ok !== false || view.installs.reason !== 'unexpected-arguments') problems.push('folder scan did not refuse the data directory');
  if (view.readFull !== null) problems.push('full arguments were accepted');
  if (!view.readWithoutDataDir) problems.push('arguments without the data directory were refused');
  if (!view.proxy) problems.push('target is not the browser proxy');
  return { ...view, ok: problems.length === 0, problems };
}

// What the browser keeps for an installed app inside one profile, read only, so a later check can tell an
// installed app from a shortcut that outlived it.
async function webAppData(userData) {
  const base = join(userData, 'Default');
  const listing = [];
  async function walk(dir, depth) {
    if (depth > 4 || listing.length >= 300) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      listing.push(`${dir.slice(base.length)} ! ${error.code}`);
      return;
    }
    for (const entry of entries) {
      if (listing.length >= 300) return;
      const full = join(dir, entry.name);
      listing.push(`${full.slice(base.length)}${entry.isDirectory() ? '\\' : ''}`);
      if (entry.isDirectory()) await walk(full, depth + 1);
    }
  }
  await walk(join(base, 'Web Applications'), 0);
  const mentions = {};
  for (const file of ['Preferences', 'Secure Preferences']) {
    try {
      mentions[file] = (await readFile(join(base, file), 'latin1')).includes(APP_ID);
    } catch (error) {
      mentions[file] = error.code;
    }
  }
  return { listing, mentions };
}

const encoded = (text) => `([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(text).toString('base64')}')))`;

// The package a process runs in, from GetPackageFullName: a browser started from inside the package would
// carry it, and its writes to AppData could then land in the package's own LocalCache.
const PACKAGE_NAME_SOURCE = `using System; using System.Runtime.InteropServices; using System.Text;
public static class RecapProbePackage {
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int id);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern int GetPackageFullName(IntPtr handle, ref uint length, StringBuilder name);
  public static string Of(int id) {
    IntPtr handle = OpenProcess(0x1000, false, id);
    if (handle == IntPtr.Zero) return "open failed " + Marshal.GetLastWin32Error();
    try {
      uint length = 0;
      int code = GetPackageFullName(handle, ref length, null);
      if (code == 15700) return "";
      if (code != 122) return "error " + code;
      StringBuilder name = new StringBuilder((int)length);
      code = GetPackageFullName(handle, ref length, name);
      return code == 0 ? name.ToString() : "error " + code;
    } finally { CloseHandle(handle); }
  }
}`;

function browserProcesses(spec) {
  const entries = imageProcesses([spec.image, spec.proxy]);
  if (!entries.length) return [];
  const names = psJson(`Add-Type -TypeDefinition ${encoded(PACKAGE_NAME_SOURCE)};
    @(${entries.map((entry) => Number(entry.ProcessId)).join(',')}) | ForEach-Object {
      [PSCustomObject]@{ id = $_; packageFullName = [RecapProbePackage]::Of($_) } }`);
  const byId = new Map(names.map((entry) => [entry.id, entry.packageFullName]));
  return entries.map((entry) => ({
    id: entry.ProcessId, parent: entry.ParentProcessId, packageFullName: byId.get(entry.ProcessId) ?? null,
    commandLine: /--type=/.test(entry.CommandLine ?? '') ? '(child)' : entry.CommandLine,
  }));
}

// With the package each one runs in: the startup consent (#1412) has the server ask Windows about the
// package's startup task through a process it starts, which only works if the server carries the identity.
const packageProcesses = () => psJson(`Add-Type -TypeDefinition ${encoded(PACKAGE_NAME_SOURCE)};
  $location = (Get-AppxPackage -Name '${PACKAGE_NAME}' | Select-Object -First 1).InstallLocation;
  if ($location) { Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and
    $_.ExecutablePath.StartsWith($location, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object {
      [PSCustomObject]@{ ProcessId = $_.ProcessId; Name = $_.Name; CommandLine = $_.CommandLine;
        packageFullName = [RecapProbePackage]::Of([int]$_.ProcessId) } } }`);

const localCache = () => psJson(`$root = Join-Path $env:LOCALAPPDATA 'Packages\\${PACKAGE_FAMILY}';
  if (Test-Path -LiteralPath $root) { Get-ChildItem -LiteralPath $root -Recurse -Depth 5 -Force -ErrorAction SilentlyContinue |
    Select-Object -First 400 | ForEach-Object { $_.FullName.Substring($root.Length) } }`);

const newWindows = (before) => allWindows().filter((entry) => !before.has(`${entry.Id}:${entry.MainWindowTitle}`));
const windowKeys = () => new Set(allWindows().map((entry) => `${entry.Id}:${entry.MainWindowTitle}`));
const stopImages = (images) => { for (const entry of imageProcesses(images)) stopProcess(entry.ProcessId); };

// A shortcut can outlive its app: an uninstall that fails halfway, or a copy restored from a backup. Put the
// exact shortcut back after the uninstall and start what it names cold, with only the arguments a launcher
// would pass, to see whether the reader would get Recap Page, a plain browser window, or nothing.
async function staleLaunch(spec, link, args) {
  await mkdir(dirname(link.full), { recursive: true });
  await writeFile(link.full, Buffer.from(link.bytes, 'base64'));
  const beforeIds = new Set(imageProcesses([spec.image, spec.proxy]).map((entry) => entry.ProcessId));
  const before = windowKeys();
  const spawned = spawn(link.target, args, { detached: true, stdio: 'ignore' });
  spawned.on('error', () => {});
  spawned.unref();
  await sleep(15000);
  const windows = newWindows(before);
  const started = imageProcesses([spec.image, spec.proxy]).filter((entry) => !beforeIds.has(entry.ProcessId));
  const result = {
    args, windows,
    processes: started.map((entry) => entry.CommandLine).filter((line) => !/--type=/.test(line ?? '')),
    appWindow: windows.some((entry) => entry.ProcessName === spec.image.replace(/\.exe$/, '') && entry.MainWindowTitle === 'Recap Page'),
    otherBrowserWindow: windows.some((entry) => entry.ProcessName === spec.image.replace(/\.exe$/, '') && entry.MainWindowTitle !== 'Recap Page'),
  };
  for (const entry of started) stopProcess(entry.ProcessId);
  await sleep(3000);
  await rm(link.full, { force: true });
  result.removed = !(await readFile(link.full).then(() => true, () => false));
  return result;
}

async function probe(spec) {
  // The runner's tmpdir() is an 8.3 short path (RUNNER~1); RUNNER_TEMP is the long form.
  const profile = await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(), `recap-pwa-probe-${spec.name}-`));
  const since = new Date(Date.now() - 5000).toISOString();
  const record = { browser: spec.name, manifestId, predictedAppId, profile };
  let browser;
  let installed = false;
  try {
    record.version = ps(`(Get-Item -LiteralPath '${spec.exe}').VersionInfo.ProductVersion`);
    try {
      record.userChoice = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice', '/v', 'ProgId'], { encoding: 'utf8' });
    } catch (error) {
      record.userChoice = `error ${error.status}`;
    }
    browser = await startBrowser(spec, profile);
    const cdp = await browser.target().createCDPSession();
    const page = await browser.newPage();
    await page.goto(manifestId, { waitUntil: 'networkidle0' });
    const tabWindowId = (await (await page.target().createCDPSession()).send('Browser.getWindowForTarget')).windowId;
    await cdp.send('PWA.install', { manifestId, installUrlOrBundleUrl: manifestId });
    installed = true;
    await cdp.send('PWA.changeAppUserSettings', { manifestId, displayMode: 'standalone' }).catch((error) => { record.settingsError = error.message; });
    await sleep(3000);
    const internals = await browser.newPage();
    await internals.goto(spec.internals);
    await internals.waitForFunction('document.querySelector("web-app-internals-app")?.shadowRoot?.querySelector("pre")', { timeout: 15000 });
    const state = JSON.parse(await internals.evaluate('document.querySelector("web-app-internals-app").shadowRoot.querySelector("pre").textContent'));
    await internals.close();
    const details = state.InstalledWebApps.Details.find((entry) => entry.manifest_id === manifestId);
    record.internals = details;
    record.appId = details?.['!app_id'];
    record.appIdMatchesPrediction = record.appId === predictedAppId;
    record.links = links(since);
    record.startApps = startApps();
    record.uninstall = uninstallKeys();
    record.protocols = protocolKeys();
    record.run = runKeys();
    record.appx = appxPackage(details?.packaged_app_family_name);
    const link = record.links.find((entry) => entry.arguments.includes(`--app-id=${record.appId}`));
    // What a launcher would pass: only the profile and app selectors, never automation flags.
    const parsed = link ? splitArguments(link.arguments) : [];
    const filtered = parsed.filter((token) => /^--(user-data-dir|profile-directory|app-id)=/.test(token));
    record.module = await moduleView(link);
    const aumid = details?.edge_web_app_user_model_id || link?.aumid || record.startApps[0]?.AppID;
    record.launches = [];
    if (link) {
      record.parsedArguments = parsed;
      record.launches.push(await warmLaunch(browser, spec, 'warm-shortcut-file', () => ps(`Start-Process -FilePath '${link.full.replace(/'/g, "''")}'`), tabWindowId));
      record.launches.push(await warmLaunch(browser, spec, 'warm-shortcut-target', () => spawnAndWait(link.target, parsed), tabWindowId));
      record.launches.push(await warmLaunch(browser, spec, 'warm-proxy-filtered', () => spawnAndWait(link.target, filtered), tabWindowId));
      record.launches.push(await warmLaunch(browser, spec, 'warm-browser-filtered', () => spawnAndWait(spec.exe, filtered), tabWindowId));
    }
    if (aumid) {
      record.launches.push(await warmLaunch(browser, spec, 'warm-aumid', () => ps(`Start-Process -FilePath 'explorer.exe' -ArgumentList 'shell:AppsFolder\\${aumid}'`), tabWindowId));
    }
    await browser.close();
    browser = null;
    await sleep(3000);
    record.lingering = imageProcesses([spec.image, spec.proxy]).map((entry) => entry.CommandLine);
    for (const entry of imageProcesses([spec.image])) if ((entry.CommandLine ?? '').includes(profile)) stopProcess(entry.ProcessId);
    await sleep(2000);
    if (link) {
      const beforeIds = new Set(imageProcesses([spec.image, spec.proxy]).map((entry) => entry.ProcessId));
      const windowsBefore = new Set(allWindows().map((entry) => `${entry.Id}:${entry.MainWindowTitle}`));
      const spawned = spawn(link.target, filtered, { detached: true, stdio: 'ignore' });
      spawned.unref();
      await sleep(15000);
      const started = imageProcesses([spec.image, spec.proxy]).filter((entry) => !beforeIds.has(entry.ProcessId));
      record.coldProxyFiltered = {
        args: filtered,
        processes: started.map((entry) => entry.CommandLine).filter((line) => !/--type=/.test(line ?? '')),
        windows: allWindows().filter((entry) => !windowsBefore.has(`${entry.Id}:${entry.MainWindowTitle}`)),
      };
      for (const entry of started) stopProcess(entry.ProcessId);
      await sleep(3000);
    }
    browser = await startBrowser(spec, profile);
    record.webAppDataInstalled = await webAppData(profile);
    await (await browser.target().createCDPSession()).send('PWA.uninstall', { manifestId });
    installed = false;
    await sleep(3000);
    record.afterUninstall = { links: links(since).filter((entry) => entry.arguments.includes(`--app-id=${record.appId}`)), startApps: startApps(), uninstall: uninstallKeys() };
    record.webAppDataUninstalled = await webAppData(profile);
    await browser.close();
    browser = null;
    await sleep(3000);
    for (const entry of imageProcesses([spec.image])) if ((entry.CommandLine ?? '').includes(profile)) stopProcess(entry.ProcessId);
    await sleep(2000);
    if (link) {
      record.stale = await staleLaunch(spec, link, filtered);
      record.webAppDataStale = await webAppData(profile);
    }
  } catch (error) {
    record.error = error.stack;
  } finally {
    if (browser) await browser.close().catch(() => {});
    record.cleanedUp = !installed;
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }).catch(() => {});
  }
  return record;
}

const EDGE = browsers[0];
const EDGE_POLICY_KEY = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge';
const FORCE_LIST = JSON.stringify([{ url: APP_WINDOW_URL, default_launch_container: 'window', create_desktop_shortcut: false }]);
// Run 43950758373's warm launch opened "Recap Page - Home | Recap Page": an app window names the app and
// then the page, while a browser window ends in the browser's name, sometimes with a zero-width space in it.
const isAppWindow = (entry) => entry.ProcessName === 'msedge'
  && /^Recap Page(?: - |$)/.test(entry.MainWindowTitle ?? '')
  && !/Microsoft\u200b? ?Edge$/.test(entry.MainWindowTitle);
const defaultLinks = (since) => links(since).filter((entry) => /Programs$/.test(entry.root)
  && entry.arguments.includes(`--app-id=${APP_ID}`) && !entry.arguments.includes('--user-data-dir'));

function startEdgePlain() {
  // Chromium 136 and later refuse a debugging connection on the default data directory, and a reader's
  // browser is never automated, so the Default profile is only ever started the way a reader starts it.
  const child = spawn(EDGE.exe, ['--no-first-run', '--no-default-browser-check'], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

async function stopEdge() {
  stopImages([EDGE.image, EDGE.proxy]);
  await sleep(3000);
}

async function waitFor(check, ms) {
  for (let waited = 0; waited <= ms; waited += 2000) {
    const value = await check();
    if (value) return value;
    await sleep(2000);
  }
  return null;
}

async function defaultState(since) {
  return {
    links: defaultLinks(since).map(({ root, relative, target, arguments: args }) => ({ root, relative, target, arguments: args })),
    installs: await findInstalls(),
    resolved: await resolveAppWindow(APP_WINDOW_URL), defaultBrowser: await readDefaultBrowser(),
    data: await webAppData(join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data')),
  };
}

// Start the package from its Start entry, as a reader would, and record what opened, which package each
// browser process runs in, and what landed in the package's own storage.
async function activate(label, { warm }) {
  await stopEdge();
  if (warm) {
    startEdgePlain();
    await sleep(8000);
  }
  const before = windowKeys();
  let error = null;
  try {
    ps(`Start-Process -FilePath 'explorer.exe' -ArgumentList 'shell:AppsFolder\\${AUMID}'`);
  } catch (caught) {
    error = caught.message;
  }
  await sleep(25000);
  const windows = newWindows(before);
  const edge = browserProcesses(EDGE);
  const record = {
    label, warm, error, windows, appWindow: windows.some(isAppWindow), edge,
    packagedBrowserProcesses: edge.filter((entry) => entry.packageFullName).length,
    package: packageProcesses(), localCache: localCache(),
  };
  for (const entry of packageProcesses()) stopProcess(entry.ProcessId);
  await stopEdge();
  return record;
}

// The startup task's state as Windows keeps it, read only: 1 is disabled and 2 enabled.
const STARTUP_TASK_KEY = 'HKCU:\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel'
  + `\\SystemAppData\\${PACKAGE_FAMILY}\\RecapPageStartup`;
const startupTaskRecord = () => psJson(`Get-ItemProperty -LiteralPath '${STARTUP_TASK_KEY}' -ErrorAction SilentlyContinue |
  Select-Object State, UserEnabledStartupOnce`);
const stopPackage = async () => {
  for (const entry of packageProcesses()) stopProcess(entry.ProcessId);
  await sleep(3000);
};

// A same-origin request as the app window's own fetch makes it; a header given as undefined is left out.
function startupCall(operation, body, overrides = {}) {
  return new Promise((resolve) => {
    const text = JSON.stringify(body);
    const headers = Object.fromEntries(Object.entries({
      host: `${HOST}:${PORT}`, origin, 'sec-fetch-site': 'same-origin', [STARTUP_API_HEADER]: '1',
      'content-type': 'application/json', 'content-length': Buffer.byteLength(text), ...overrides,
    }).filter(([, value]) => value !== undefined));
    const req = httpRequest({ host: HOST, port: PORT, method: 'POST', path: `${STARTUP_API_PREFIX}${operation}`, headers, timeout: 40000 },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch { /* recorded as text */ }
          resolve({ status: res.statusCode, body: json ?? data.slice(0, 400) });
        });
      });
    req.on('error', (error) => resolve({ error: error.message }));
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(text);
  });
}

const engineReady = async (ms) => (await waitFor(async () => {
  try {
    return (await fetch(`${origin}/`, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}, ms)) === true;

// Every process seen running from the package while it starts, with the command line Windows gave it.
async function watchPackage(ms) {
  const seen = new Map();
  for (const end = Date.now() + ms; Date.now() < end;) {
    for (const entry of packageProcesses()) seen.set(entry.ProcessId, entry);
    await sleep(300);
  }
  return [...seen.values()];
}

const launcherArguments = (processes) => processes.filter((entry) => /^RecapPageLauncher\.exe$/i.test(entry.Name))
  .map((entry) => String(entry.CommandLine ?? '').replace(/^\s*(?:"[^"]*"|\S+)\s*/, '').trim());

// Start the package through a route other than its Start entry and record what ran, whether the engine
// answered and whether any window opened: Reconnect and sign-in must start only the engine.
async function quietActivation(label, start) {
  await stopPackage();
  await stopEdge();
  const before = windowKeys();
  let error = null;
  try {
    start();
  } catch (caught) {
    error = caught.message;
  }
  const processes = await watchPackage(12000);
  const ready = await engineReady(30000);
  await sleep(3000);
  const windows = newWindows(before);
  return {
    label, error, engineReady: ready, windows, launcherArguments: launcherArguments(processes),
    processes: processes.map(({ Name, CommandLine, packageFullName }) => ({ Name, CommandLine, packageFullName })),
    browserWindows: windows.filter((entry) => entry.ProcessName === 'msedge').length,
  };
}

async function mechanismsPhase() {
  const record = {};
  const protocol = (uri) => () => ps(`Start-Process -FilePath ${encoded(uri)}`);
  record.reconnect = await quietActivation('reconnect', protocol('recap-page:'));
  // Web content controls the whole address; with fixed Parameters and no %1 none of it may reach the launcher.
  record.reconnectJunk = await quietActivation('reconnect-junk',
    protocol('recap-page://x/--recap-startup-enable-v1 "C:\\Windows\\System32\\calc.exe" --user-data-dir=C:\\x?a=b c'));
  record.startupBefore = startupTaskRecord();
  record.startupRefusedWithoutSite = await startupCall('state', {}, { 'sec-fetch-site': undefined });
  record.startupState = await startupCall('state', {});
  const consent = record.startupState.body?.state === 'disabled' ? record.startupState.body.consent : null;
  if (consent) {
    record.startupEnable = await startupCall('enable', { consent });
    record.startupReplay = await startupCall('enable', { consent });
    record.startupAfter = await startupCall('state', {});
  }
  record.startupRegistry = startupTaskRecord();
  // Sign-in cannot be repeated on a runner, so the task's own fixed parameter is given to the launcher inside the
  // package, which is what Windows does at sign-in. The real sign-in stays the owner's manual check.
  record.signInSimulated = await quietActivation('sign-in-simulated', () => ps(`
    $location = (Get-AppxPackage -Name '${PACKAGE_NAME}' | Select-Object -First 1).InstallLocation;
    Invoke-CommandInDesktopPackage -PackageFamilyName '${PACKAGE_FAMILY}' -AppId '${AUMID.split('!')[1]}' -Command (Join-Path $location 'RecapPageLauncher.exe') -Args '--recap-startup-task-v1'`));
  await stopPackage();
  record.verdicts = {
    reconnectQuiet: record.reconnect.engineReady && record.reconnect.browserWindows === 0,
    reconnectFixedToken: record.reconnect.launcherArguments.length > 0
      && record.reconnect.launcherArguments.every((args) => args === '--recap-reconnect-v1'),
    junkFixedToken: record.reconnectJunk.launcherArguments.length > 0
      && record.reconnectJunk.launcherArguments.every((args) => args === '--recap-reconnect-v1'),
    junkQuiet: record.reconnectJunk.engineReady && record.reconnectJunk.browserWindows === 0,
    serverKeptIdentity: typeof record.startupState.body?.state === 'string' && record.startupState.body.state !== 'unavailable',
    refusedWithoutSite: record.startupRefusedWithoutSite.status === 403,
    enabled: record.startupEnable?.body?.state === 'enabled' && record.startupAfter?.body?.state === 'enabled',
    consentSingleUse: record.startupReplay?.status === 403,
    signInQuiet: record.signInSimulated.engineReady && record.signInSimulated.browserWindows === 0,
  };
  return record;
}

async function packagePhase(serve) {
  const since = new Date(Date.now() - 5000).toISOString();
  const record = { phase: 'package', aumid: AUMID, family: PACKAGE_FAMILY };
  let policySet = false;
  let restored = null;
  const clearPolicy = () => ps(`Remove-ItemProperty -Path '${EDGE_POLICY_KEY}' -Name 'WebAppInstallForceList' -ErrorAction SilentlyContinue`);
  try {
    record.appx = appxPackage(PACKAGE_FAMILY);
    record.defaultBrowser = await readDefaultBrowser();
    record.localCacheBefore = localCache();
    await stopEdge();
    ps(`New-Item -Path '${EDGE_POLICY_KEY}' -Force | Out-Null;
      New-ItemProperty -Path '${EDGE_POLICY_KEY}' -Name 'WebAppInstallForceList' -PropertyType String -Value ${encoded(FORCE_LIST)} -Force | Out-Null`);
    policySet = true;
    await serve(true);
    startEdgePlain();
    const installed = await waitFor(() => defaultLinks(since)[0], 120000);
    record.forceInstall = installed ? { root: installed.root, relative: installed.relative, target: installed.target, arguments: installed.arguments } : 'inconclusive: no Default shortcut within 120 s';
    await sleep(3000);
    record.installedState = await defaultState(since);
    await stopEdge();
    await serve(false);
    if (installed) {
      record.appCold = await activate('app-cold', { warm: false });
      record.appWarm = await activate('app-warm', { warm: true });
    }
    try {
      record.mechanisms = await mechanismsPhase();
    } catch (error) {
      record.mechanisms = { error: error.stack };
    }
    clearPolicy();
    policySet = false;
    startEdgePlain();
    record.shortcutRemovedWithPolicy = (await waitFor(() => defaultLinks(since).length === 0, 90000)) === true;
    await sleep(3000);
    record.removedState = await defaultState(since);
    await stopEdge();
    record.tabCold = await activate('tab-cold', { warm: false });
    if (installed) {
      await mkdir(dirname(installed.full), { recursive: true });
      await writeFile(installed.full, Buffer.from(installed.bytes, 'base64'));
      restored = installed.full;
      await serve(true);
      record.staleState = await defaultState(since);
      const before = windowKeys();
      const returned = await openAppWindow(APP_WINDOW_URL);
      await sleep(15000);
      const windows = newWindows(before);
      record.staleOpen = {
        returned, windows, appWindow: windows.some(isAppWindow),
        otherBrowserWindow: windows.some((entry) => entry.ProcessName === 'msedge' && !isAppWindow(entry)),
        edge: browserProcesses(EDGE),
      };
      await stopEdge();
      await serve(false);
      // The reader's own route with the stale shortcut in place: the Start entry must open today's tab, never
      // a browser window without Recap Page in it.
      record.staleLaunch = await activate('stale-cold', { warm: false });
      record.staleLaunchTab = record.staleLaunch.windows.some((entry) => entry.ProcessName === 'msedge'
        && /Recap Page/.test(entry.MainWindowTitle ?? '') && !isAppWindow(entry));
    }
  } catch (error) {
    record.error = error.stack;
  } finally {
    if (restored) await rm(restored, { force: true }).catch(() => {});
    if (policySet) {
      try { clearPolicy(); } catch (error) { record.cleanupError = error.message; }
    }
    try {
      for (const entry of packageProcesses()) stopProcess(entry.ProcessId);
      await stopEdge();
    } catch (error) {
      record.cleanupError = error.message;
    }
    await serve(false);
  }
  return record;
}

let server = null;
async function serve(on) {
  if (on && !server) {
    const next = createStaticServer();
    await new Promise((resolve, reject) => { next.once('error', reject); next.listen(PORT, HOST, resolve); });
    server = next;
  } else if (!on && server) {
    const current = server;
    server = null;
    current.closeAllConnections();
    await new Promise((resolve) => current.close(resolve));
  }
}

await serve(true);
const results = [];
try {
  for (const spec of browsers) {
    const record = await probe(spec);
    results.push(record);
    await writeFile(join(evidence, `${spec.name}.json`), JSON.stringify(record, null, 2));
    console.log(JSON.stringify(record, null, 2));
  }
  if (process.env.MRT_PWA_PACKAGE === 'installed') {
    const record = await packagePhase(serve);
    results.push(record);
    await writeFile(join(evidence, 'package.json'), JSON.stringify(record, null, 2));
    console.log(JSON.stringify(record, null, 2));
  }
} finally {
  await serve(false);
}
if (results.some((record) => record.error || (record.phase !== 'package' && record.module?.ok !== true))) process.exitCode = 1;
