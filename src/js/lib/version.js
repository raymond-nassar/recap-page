// The single source of truth for the build number the UI reports.
//
// What the number means, since a version is worthless if nobody knows what it promises:
//
//   MAJOR  changes the stored data in a way an older build cannot read. Anyone who has
//          reading progress saved should export a backup before upgrading across one.
//   MINOR  adds a feature or changes the interface while leaving stored data readable by
//          the previous build.
//   PATCH  fixes behaviour without changing data or the interface.
//
// The stored data is the axis that matters here, because the app keeps every user's
// reading progress in their own browser and there is no server to migrate it for them.
// `SCHEMA_VERSION` in lib/model.js is the mechanical counterpart: it is what the loader
// actually checks. The two numbers are not equal and never will be, because the format
// moved twice while the app was still on 0.x. What the rule means from 1.0.0 onward is
// that raising SCHEMA_VERSION requires raising MAJOR in the same release.
//
// test/version.test.js asserts this matches package.json, so the two cannot drift.
export const APP_VERSION = '1.4.0';
