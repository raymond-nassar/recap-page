---
name: refresh-store-assets
description: Prepare or verify Windows, Google Play, or iOS store asset captures using the applicable runbook. Use when a request asks to refresh store screenshots, captions, listing images, or asset packets.
---

# Refresh store assets

## Goal

Choose the applicable Windows, Google Play, or iOS capture route and preserve a reviewable asset
packet without treating local capture as native observation or publication.

## Flow

1. Select the platform runbook and capture route. Use only fictional, disposable fixtures. Never
   capture comic artwork bytes or private saved state.
2. Record source identity, hashes, dimensions, and manual image-review evidence for every captured
   asset.
3. Distinguish local capture from native-device observation and from publication.
4. Treat workflow dispatch, upload, console mutation, and protected rerun as separate actions that
   need exact authorization. The owner enters credentials. Before recording external success, read
   back edited fields before saving, reload and read them again after saving, and verify the
   external state.

## Evidence

For Windows assets, use the [Store asset procedure](../../../docs/MICROSOFT_STORE_SUBMISSION.md#listing-assets)
and its captions and limits. For iOS assets, use the [App Store screenshots](../../../docs/IOS.md#app-store-screenshots)
procedure. For Google Play work, the same
[Listing assets procedure](../../../docs/MICROSOFT_STORE_SUBMISSION.md#listing-assets)
owns the phone capture route and its caption and limit requirements.

## Limits and stop behavior

Do not upload, publish, mutate a console, use credentials, or rerun a protected workflow without
separate exact authorization. Stop when the applicable route, source identity, manual review, or
external confirmation is missing.
