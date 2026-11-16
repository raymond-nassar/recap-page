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
  { name: 'edge', exe: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', internals: 'edge://web-app-internals', image: 'msedge.exe' },
  { name: 'chrome', exe: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', internals: 'chrome://web-app-internals', image: 'chrome.exe' },
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

function windows(image) {
  const base = image.replace(/\.exe$/, '');
  return psJson(`Get-Process -Name '${base}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object Id, MainWindowTitle`);
}

function splitArguments(text) {
  return [...text.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2]);
}

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

async function warmLaunch(browser, label, launch, tabWindowId) {
  const before = new Set(browser.targets());
  let error = null;
  try { await launch(); } catch (caught) { error = caught.message; }
  let found = [];
  for (let waited = 0; waited < 20000 && !found.length; waited += 500) {
    await sleep(500);
    found = await standaloneTargets(browser, before);
  }
  const result = { label, error, opened: found.map(({ url, standalone, windowId }) => ({ url, standalone, separateWindow: windowId !== tabWindowId })) };
  for (const { page } of found) await page.close().catch(() => {});
  return result;
}

async function probe(spec) {
  const profile = await mkdtemp(join(tmpdir(), `recap-pwa-probe-${spec.name}-`));
  const since = new Date(Date.now() - 5000).toISOString();
  const record = { browser: spec.name, manifestId, predictedAppId, profile };
  let browser;
  let installed = false;
  try {
    record.version = ps(`(Get-Item -LiteralPath '${spec.exe}').VersionInfo.ProductVersion`);
    browser = await puppeteer.launch({
      executablePath: spec.exe, headless: false, userDataDir: profile, pipe: true,
      args: ['--no-first-run', '--no-default-browser-check', '--disable-background-networking'],
      defaultViewport: { width: 1280, height: 900 },
    });
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
      record.launches.push(await warmLaunch(browser, 'warm-shortcut-file', () => ps(`Start-Process -FilePath '${link.full.replace(/'/g, "''")}'`), tabWindowId));
      record.launches.push(await warmLaunch(browser, 'warm-shortcut-target', () => {
        spawn(link.target, splitArguments(link.arguments), { detached: true, stdio: 'ignore' }).unref();
      }, tabWindowId));
    }
    if (aumid) {
      record.launches.push(await warmLaunch(browser, 'warm-aumid', () => ps(`Start-Process -FilePath 'explorer.exe' -ArgumentList 'shell:AppsFolder\\${aumid}'`), tabWindowId));
    }
    await browser.close();
    browser = null;
    await sleep(3000);
    if (link) {
      const beforeIds = new Set(processes(spec.image).map((entry) => entry.ProcessId));
      ps(`Start-Process -FilePath '${link.full.replace(/'/g, "''")}'`);
      await sleep(10000);
      const started = processes(spec.image).filter((entry) => !beforeIds.has(entry.ProcessId));
      record.coldShortcut = { processes: started.map((entry) => entry.CommandLine), windows: windows(spec.image) };
      for (const entry of started) ps(`Stop-Process -Id ${entry.ProcessId} -Force -ErrorAction SilentlyContinue`);
      await sleep(2000);
    }
    browser = await puppeteer.launch({
      executablePath: spec.exe, headless: false, userDataDir: profile, pipe: true,
      args: ['--no-first-run', '--no-default-browser-check', '--disable-background-networking'],
    });
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
