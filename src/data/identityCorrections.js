// #1601: evidence-backed identity corrections for published reading orders. Each entry says that,
// in the guide named by catalogId, the comic saved as `from` is the comic now saved as `to`.
// src/js/lib/identityReconcile.js validates the whole table before using any of it and moves saved
// progress only under the owner's one-to-one, no-conflict rule recorded on the Issue.
//
// Entry shape: { catalogId, from, to, appViewer?, title, evidence }. A negative `to` is a viewer-only
// comic and must carry the appViewer its key was made from. Entries are added with their guide data
// and its reading-order revision, never on their own.
export const identityCorrections = Object.freeze([]);
