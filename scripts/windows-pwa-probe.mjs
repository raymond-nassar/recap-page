// Hosted-runner measurement for #1412: installing a browser app creates per-user Start and
// uninstall registrations, so this never runs on a reader's machine. It records where Edge and
// Chrome put the installed app's shortcut, which app id they derive for the fixed origin, and
// which launch routes open a standalone window in the same profile.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createStaticServer, DEFAULT_PORT as PORT, HOST } from '../server.mjs';

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
            aumid = $item.ExtendedProperty('System.AppUserModel.ID'); full = $_.FullName }
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

async function probe(spec) {
  // The runner's tmpdir() is an 8.3 short path (RUNNER~1); RUNNER_TEMP is the long form.
  const profile = await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(), `recap-pwa-probe-${spec.name}-`));
  const since = new Date(Date.now() - 5000).toISOString();
  const record = { browser: spec.name, manifestId, predictedAppId, profile };
  let browser;
  let installed = false;
  try {
    record.version = ps(`(Get-Item -LiteralPath '${spec.exe}').VersionInfo.ProductVersion`);
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
    const aumid = details?.edge_web_app_user_model_id || link?.aumid || record.startApps[0]?.AppID;
    record.launches = [];
    if (link) {
      const parsed = splitArguments(link.arguments);
      record.parsedArguments = parsed;
      // What a launcher would pass: only the profile and app selectors, never automation flags.
      const filtered = parsed.filter((token) => /^--(user-data-dir|profile-directory|app-id)=/.test(token));
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
      const parsed = splitArguments(link.arguments);
      const filtered = parsed.filter((token) => /^--(user-data-dir|profile-directory|app-id)=/.test(token));
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
    await (await browser.target().createCDPSession()).send('PWA.uninstall', { manifestId });
    installed = false;
    await sleep(3000);
    record.afterUninstall = { links: links(since).filter((entry) => entry.arguments.includes(`--app-id=${record.appId}`)), startApps: startApps(), uninstall: uninstallKeys() };
  } catch (error) {
    record.error = error.stack;
  } finally {
    if (browser) await browser.close().catch(() => {});
    record.cleanedUp = !installed;
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }).catch(() => {});
  }
  return record;
}

const server = createStaticServer();
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, HOST, resolve); });
const results = [];
try {
  for (const spec of browsers) {
    const record = await probe(spec);
    results.push(record);
    await writeFile(join(evidence, `${spec.name}.json`), JSON.stringify(record, null, 2));
    console.log(JSON.stringify(record, null, 2));
  }
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
if (results.some((record) => record.error)) process.exitCode = 1;
