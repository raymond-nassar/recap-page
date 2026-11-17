# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Marvel readers who want guided reading orders and a way to keep their place, including newcomers and experienced readers. The public project page is especially intended to help newcomers find a way into Marvel comics.

## Product Purpose

Recap Page is a local-first companion for following Marvel reading orders and tracking reading progress. Its mission is to make Marvel reading orders easier to follow, so readers can keep their place and enjoy the story.

## Positioning

Recap Page combines curated reading orders and progress tracking with multiple ways to explore Marvel comics, including a Modern Timeline, character and genre discovery, and MCU Prep guides. It does not provide comics or replace a comic reader.

## Operating Context

The product is available on Windows, Android, iPhone, and iPad. Desktop progress is kept in the same browser profile and loopback origin. Installations save separately. Readers can move their own data with backups; optional cloud backup uses a reader's own storage account.

## Capabilities and Constraints

- Readers can browse, follow, and track progress through ordered comic lists, explore comics in different ways, defer an issue, create personal lists, and share a checklist.
- Lists have different origins. Some follow published guides, some are assembled from Marvel series metadata, and some are selected or compiled for the project. Each guide-derived list identifies and links its source. Source permissions and exclusions are specific to the source; do not imply one permission applies to every list.
- Comics are not included. Store cover URLs, never comic image bytes. Do not host, proxy, cache, or store comic artwork.
- There are no Recap Page accounts, hosted backends, analytics, or automatic cross-device synchronization. Saved data stays local unless the reader exports it or explicitly enables the supported backup to their own cloud storage.
- Browser runtime dependencies remain at zero.
- The bundled comic metadata snapshot ends in 2025. Do not imply that missing metadata means a comic is unavailable.
- Preserve the distinct unknown, scheduled, expected, explicitly available, and explicitly unavailable states.

## Brand Commitments

Keep the Recap Page name, retained icon, existing wordmark, and purple identity. Welcome new and experienced Marvel readers without age targeting. The site should describe real capabilities concretely and avoid competitor comparisons. The approved mission is: "Our mission is to make Marvel reading orders easier to follow, so you can keep your place and enjoy the story."

## Evidence on Hand

- `CONTRIBUTING.md` and `docs/CONTRIBUTOR_REFERENCE.md` describe the product purpose, data constraints, and operating model.
- `docs/BRAND_GUIDELINES.md` records the retained logo assets, color roles, audience, and approved mission.
- `pages/data-sources.md` and `docs/DATA_PROVENANCE.md` document guide sources and source-specific permissions.
- `pages/index.html` describes current features, platforms, setup, and privacy boundaries.

## Product Principles

- Keep reading progress under the reader's control.
- Make reading orders and their sources understandable.
- Preserve the actual order and identity of every listed comic.
- Explain the difference between tracking a comic and reading it.
- Make the product useful to readers new to Marvel and readers who already know it.
