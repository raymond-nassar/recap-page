import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { manifest } from './contract.mjs';

const output = process.argv[2];
if (!output) throw new Error('Pass the scratch output header path.');

function wide(value) {
  return `L"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

const source = `#pragma once
namespace prototype_config {
inline constexpr wchar_t Origin[] = ${wide(manifest.origin)};
inline constexpr wchar_t Host[] = ${wide(manifest.host)};
inline constexpr wchar_t UserDataDirectory[] = ${wide(manifest.localAppDataDirectory)};
inline constexpr wchar_t ContentSecurityPolicy[] = ${wide(manifest.securityHeaders.contentSecurityPolicy)};
inline constexpr wchar_t XContentTypeOptions[] = ${wide(manifest.securityHeaders.xContentTypeOptions)};
inline constexpr wchar_t ReferrerPolicy[] = ${wide(manifest.securityHeaders.referrerPolicy)};
inline constexpr wchar_t PermissionsPolicy[] = ${wide(manifest.securityHeaders.permissionsPolicy)};
inline constexpr wchar_t CacheControl[] = ${wide(manifest.securityHeaders.cacheControl)};
inline constexpr unsigned long long MaximumAssetBytes = ${manifest.assetPolicy.maximumBytes}ULL;
}
`;

writeFileSync(resolve(output), source, 'utf8');
