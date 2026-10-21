import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import {
  isApprovedReaderUrl,
  isLocalOriginUrl,
  manifest,
  relativeAssetPath,
} from './contract.mjs';

const nativeSource = readFileSync(new URL('./native/Prototype.cpp', import.meta.url), 'utf8');

test('manifest pins installed SDKs and keeps acquisition offline', () => {
  assert.equal(manifest.windowsSdk.version, '10.0.28000.0');
  assert.equal(manifest.windowsSdk.source, 'preinstalled');
  assert.equal(manifest.windowsSdk.download, false);
  assert.equal(manifest.webView2Sdk.version, '1.0.4078.44');
  assert.equal(manifest.webView2Sdk.cacheOnly, true);
  assert.match(manifest.webView2Sdk.sha512Base64, /^[A-Za-z0-9+/]{86}==$/);
});

test('local origin and asset paths reject origin confusion and traversal', () => {
  assert.equal(isLocalOriginUrl('https://recap-page-prototype.invalid/index.html'), true);
  assert.equal(isLocalOriginUrl('https://recap-page-prototype.invalid.evil/index.html'), false);
  assert.equal(isLocalOriginUrl('https://user@recap-page-prototype.invalid/'), false);
  assert.equal(isLocalOriginUrl('https://recap-page-prototype.invalid:444/'), false);
  assert.equal(isLocalOriginUrl('https://recap-page-prototype.invalid:443/'), false);
  assert.equal(isLocalOriginUrl('http://recap-page-prototype.invalid/'), false);
  assert.equal(relativeAssetPath('https://recap-page-prototype.invalid/'), 'index.html');
  assert.equal(relativeAssetPath('https://recap-page-prototype.invalid/js/app.js?v=1'), 'js/app.js');
  assert.equal(relativeAssetPath('https://recap-page-prototype.invalid/%2e%2e/private.txt'), null);
  assert.equal(relativeAssetPath('https://recap-page-prototype.invalid/../private.txt'), null);
  assert.equal(relativeAssetPath('https://recap-page-prototype.invalid/a%5c..%5csecret'), null);
});

test('only HTTPS Marvel hosts are approved for external reader handoff', () => {
  assert.equal(isApprovedReaderUrl('https://read.marvel.com/#/book/123'), true);
  assert.equal(isApprovedReaderUrl('https://www.marvel.com/comics/issue/123/'), true);
  assert.equal(isApprovedReaderUrl('https://marvel.com/'), true);
  assert.equal(isApprovedReaderUrl('http://read.marvel.com/#/book/123'), false);
  assert.equal(isApprovedReaderUrl('https://read.marvel.com.example.org/#/book/123'), false);
  assert.equal(isApprovedReaderUrl('https://read.marvel.com:444/#/book/123'), false);
  assert.equal(isApprovedReaderUrl('https://read.marvel.com:443/#/book/123'), false);
  assert.equal(isApprovedReaderUrl('https://user@read.marvel.com/#/book/123'), false);
});

test('native shell uses local WebView content, isolated data, and no server launcher', () => {
  assert.match(nativeSource, /SetVirtualHostNameToFolderMapping/);
  assert.match(nativeSource, /WebResourceRequested/);
  assert.match(nativeSource, /COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW/);
  assert.match(nativeSource, /prototype_config::UserDataDirectory/);
  assert.match(nativeSource, /ShellExecuteW/);
  assert.doesNotMatch(nativeSource, /CreateProcessW|127\.0\.0\.1:8787|node\.exe/i);
});
