// The single source of truth for the build number the UI reports.
//
// What the number means, since a version is worthless if nobody knows what it promises:
//
//   MAJOR  marks a substantial new product generation. It is also required when stored data
//          changes in a way an older build cannot read.
//   MINOR  adds a feature or changes the interface within the current product generation while
//          leaving stored data readable by the previous build.
//   PATCH  fixes behaviour without intentionally changing data or the interface.
//
// Product generations are a maintainer decision about the experience as a whole, not a count of
// isolated changes. Stored-data compatibility remains a hard lower bound because reading progress
// lives only in the reader's browser and no hosted service can migrate it. `SCHEMA_VERSION` in
// lib/model.js is the mechanical counterpart: raising it requires raising MAJOR in the same release,
// but a new product generation may keep the existing schema.
//
// test/version.test.js asserts this matches package.json, so the two cannot drift.
export const APP_VERSION = '2.0.1';
