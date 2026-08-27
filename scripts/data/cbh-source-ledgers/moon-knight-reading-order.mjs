import { digestCanonicalJson } from '../../lib/cbh-inventory.mjs';

const sourceUrl = 'https://www.comicbookherald.com/moon-knight-reading-order/';
const sourceRetrievedAt = '2026-08-23';

function range({
  title,
  year,
  start,
  end,
  classification = 'provisional-canonical-candidate',
  sourcePrefix,
  sourceRangeReference,
  normalizedSeriesTitle = title,
  note = null,
}) {
  const prefix = sourcePrefix ?? `${normalizedSeriesTitle} #`;
  const reference = sourceRangeReference ?? `${normalizedSeriesTitle} #${start}${start === end ? '' : `-${end}`}`;
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const issueNumber = start + index;
    return {
      sourceIssueReference: `${prefix}${issueNumber}`,
      sourceRangeReference: reference,
      normalizedSeriesTitle,
      seriesYear: year,
      issueNumber: String(issueNumber),
      classification,
      note,
    };
  });
}

function single({
  title,
  year,
  issueNumber,
  classification = 'provisional-canonical-candidate',
  sourceIssueReference,
  sourceRangeReference,
  normalizedSeriesTitle = title,
  note = null,
}) {
  return [{
    sourceIssueReference: sourceIssueReference ?? `${normalizedSeriesTitle} #${issueNumber}`,
    sourceRangeReference: sourceRangeReference ?? `${normalizedSeriesTitle} #${issueNumber}`,
    normalizedSeriesTitle,
    seriesYear: year,
    issueNumber: String(issueNumber),
    classification,
    note,
  }];
}

function namedCandidate({
  title,
  year = null,
  sourceIssueReference,
  sourceRangeReference = null,
  note = null,
  normalizedSeriesTitle = title,
}) {
  return [{
    sourceIssueReference,
    sourceRangeReference,
    normalizedSeriesTitle,
    seriesYear: year,
    issueNumber: null,
    classification: 'provisional-canonical-candidate',
    note,
  }];
}

function namedRepeat({
  title,
  year = null,
  sourceIssueReference,
  sourceRangeReference = null,
  note = null,
  normalizedSeriesTitle = title,
  repeatOf,
}) {
  return [{
    sourceIssueReference,
    sourceRangeReference,
    normalizedSeriesTitle,
    seriesYear: year,
    issueNumber: null,
    classification: 'true-repeat',
    note,
    repeatOf,
  }];
}

function block(sourceBlockPosition, text, segments) {
  return { sourceBlockPosition, text, segments };
}

function group(heading, blocks) {
  return { heading, blocks };
}

function expandLedger(groups) {
  const canonicalFirstOccurrenceByKey = new Map();
  const sourceNodes = [];
  const issueOccurrences = [];

  for (const [groupIndex, groupEntry] of groups.entries()) {
    for (const block of groupEntry.blocks) {
      const expanded = [];
      for (const segment of block.segments) {
        for (const occurrence of segment) {
          const current = { ...occurrence };
          if (
            current.classification === 'provisional-canonical-candidate'
            && current.seriesYear != null
            && current.issueNumber != null
          ) {
            const key = [
              String(current.normalizedSeriesTitle).trim().toLowerCase(),
              String(current.seriesYear),
              String(current.issueNumber).trim(),
            ].join('|');
            if (canonicalFirstOccurrenceByKey.has(key)) {
              current.classification = 'true-repeat';
              current.repeatOf = canonicalFirstOccurrenceByKey.get(key);
            } else {
              canonicalFirstOccurrenceByKey.set(key, issueOccurrences.length + 1);
            }
          }
          current.sourceGroup = groupEntry.heading;
          current.sourceGroupPosition = groupIndex + 1;
          current.sourceBlockPosition = block.sourceBlockPosition;
          current.sourceOccurrencePosition = issueOccurrences.length + 1;
          expanded.push(current);
          issueOccurrences.push(current);
        }
      }
      sourceNodes.push({
        sourceGroup: groupEntry.heading,
        sourceGroupPosition: groupIndex + 1,
        sourceBlockPosition: block.sourceBlockPosition,
        text: block.text,
        occurrences: expanded,
      });
    }
  }

  const classifications = ['provisional-canonical-candidate', 'true-repeat', 'unresolved-included-identity-gap', 'semantic-exclusion'];
  const categoryPositions = Object.fromEntries(
    classifications
      .map((classification) => [
        classification,
        issueOccurrences
          .filter((occurrence) => occurrence.classification === classification)
          .map((occurrence) => occurrence.sourceOccurrencePosition),
      ]),
  );
  const categoryCounts = Object.fromEntries(
    classifications.map((classification) => [classification, categoryPositions[classification].length]),
  );

  const sourceBoundary = {
    status: 'exact-page-snapshot',
    pageTitle: 'Moon Knight Reading Order: Best Place to Start With Moon Knight Comics',
    canonicalUrl: sourceUrl,
    contentSha256: 'db641106edefa8524664c9e980fffdd870a60c3fc49f7f7fc841aedff9f7fa20',
    firstHeading: 'I) Moon Knight Origins & West Coast Avenger',
    lastHeading: 'Latest Additions:',
    issueBearingBlockCount: 43,
    issueBearingBlocksSha256: 'c85140bb04c82f909b9f57f8f1be084604802f5b088012bf5cfa5632acd87fb1',
    boundaryRationale: 'No qualifying Best Comics or Essential Comics subsection exists, so the full reading-order page is the frozen boundary.',
  };

  return {
    schemaVersion: 1,
    id: 'moon-knight-reading-order',
    sourceUrl,
    sourceRetrievedAt,
    sourceBoundary,
    sourceBoundaryDigest: digestCanonicalJson(sourceBoundary),
    sourceBlockCount: sourceNodes.length,
    provenanceGroupCount: groups.length,
    sourceOccurrenceCount: issueOccurrences.length,
    categoryCounts,
    categoryPositions,
    provenanceGroups: groups.map((entry, index) => ({
      sourceGroupPosition: index + 1,
      heading: entry.heading,
      blocks: sourceNodes
        .filter((node) => node.sourceGroupPosition === index + 1)
        .map((node) => ({
          sourceBlockPosition: node.sourceBlockPosition,
          text: node.text,
          occurrences: node.occurrences,
        })),
    })),
    sourceNodes,
    issueOccurrences,
  };
}

const moonKnightSourceLedger = expandLedger([
  group('I) Moon Knight Origins & West Coast Avenger', [
    block(11, 'Collects: Werewolf By Night 32-33; Marvel Spotlight 28-29; Defenders 47-50; Peter Parker, The Spectacular Spider-Man 22-23; Material From Hulk Magazine 11-15, Marvel Two-In-One 52, Hulk Magazine 17-18, 20; Material From Marvel Preview 21; Moon Knight (1980 to 1984) #1 to #4', [
      range({ title: 'Werewolf By Night', year: 1972, start: 32, end: 33, sourceRangeReference: 'Werewolf By Night 32-33' }),
      range({ title: 'Marvel Spotlight', year: 1971, start: 28, end: 29, sourceRangeReference: 'Marvel Spotlight 28-29' }),
      range({ title: 'Defenders', year: 1972, start: 47, end: 50, sourceRangeReference: 'Defenders 47-50' }),
      range({ title: 'Peter Parker, The Spectacular Spider-Man', year: 1976, start: 22, end: 23, sourceRangeReference: 'Peter Parker, The Spectacular Spider-Man 22-23' }),
      range({ title: 'Hulk Magazine', year: null, start: 11, end: 15, classification: 'semantic-exclusion', sourcePrefix: 'Hulk Magazine ', sourceRangeReference: 'Material From Hulk Magazine 11-15' }),
      single({ title: 'Marvel Two-In-One', year: 1974, issueNumber: 52, classification: 'semantic-exclusion', sourceIssueReference: 'Marvel Two-In-One 52', sourceRangeReference: 'Marvel Two-In-One 52' }),
      range({ title: 'Hulk Magazine', year: null, start: 17, end: 18, classification: 'semantic-exclusion', sourcePrefix: 'Hulk Magazine ', sourceRangeReference: 'Hulk Magazine 17-18' }),
      single({ title: 'Hulk Magazine', year: null, issueNumber: 20, classification: 'semantic-exclusion', sourceIssueReference: 'Hulk Magazine 20', sourceRangeReference: 'Hulk Magazine 20' }),
      single({ title: 'Marvel Preview', year: 1975, issueNumber: 21, classification: 'semantic-exclusion', sourceIssueReference: 'Marvel Preview 21', sourceRangeReference: 'Material From Marvel Preview 21' }),
      range({ title: 'Moon Knight', year: 1980, start: 1, end: 4, sourceRangeReference: 'Moon Knight (1980 to 1984) #1 to #4' }),
    ]),
    block(13, 'Collects: Moon Knight (1980 to 1984) #5 to #23', [
      range({ title: 'Moon Knight', year: 1980, start: 5, end: 23, sourceRangeReference: 'Moon Knight (1980 to 1984) #5 to #23' }),
    ]),
    block(15, 'Collects: Moon Knight #24 to #38', [
      range({ title: 'Moon Knight', year: 1980, start: 24, end: 38, sourceRangeReference: 'Moon Knight #24 to #38' }),
    ]),
    block(19, 'Collects: Moon Knight #31-38 (Vol. 2) #1-6, Marvel Fanfare #30, #38-39, Solo Avengers #3, Marvel Super-Heroes #1, And Marc Spector Moon Knight #1-2.', [
      range({ title: 'Moon Knight', year: 1980, start: 31, end: 38, sourceRangeReference: 'Moon Knight #31-38' }),
      range({ title: 'Moon Knight', year: 1985, start: 1, end: 6, sourcePrefix: 'Moon Knight (Vol. 2) #', sourceRangeReference: 'Moon Knight (Vol. 2) #1-6' }),
      single({ title: 'Marvel Fanfare', year: 1982, issueNumber: 30, sourceIssueReference: 'Marvel Fanfare #30', sourceRangeReference: 'Marvel Fanfare #30' }),
      range({ title: 'Marvel Fanfare', year: 1982, start: 38, end: 39, sourceRangeReference: 'Marvel Fanfare #38-39' }),
      single({ title: 'Solo Avengers', year: 1987, issueNumber: 3, sourceIssueReference: 'Solo Avengers #3', sourceRangeReference: 'Solo Avengers #3' }),
      single({ title: 'Marvel Super-Heroes', year: 1967, issueNumber: 1, sourceIssueReference: 'Marvel Super-Heroes #1', sourceRangeReference: 'Marvel Super-Heroes #1' }),
      range({ title: 'Marc Spector, Moon Knight', year: 1989, start: 1, end: 2, sourceRangeReference: 'Marc Spector, Moon Knight #1-2' }),
    ]),
    block(22, 'Collects: West Coast Avengers (1985) #8-24, Annual #1; Avengers Annual #15', [
      range({ title: 'West Coast Avengers', year: 1985, start: 8, end: 24, sourceRangeReference: 'West Coast Avengers (1985) #8-24' }),
      single({ title: 'West Coast Avengers Annual', year: 1986, issueNumber: 1, sourceIssueReference: 'West Coast Avengers Annual #1', sourceRangeReference: 'Annual #1' }),
      single({ title: 'Avengers Annual', year: 1967, issueNumber: 15, sourceIssueReference: 'Avengers Annual #15', sourceRangeReference: 'Avengers Annual #15' }),
    ]),
    block(25, 'Collects: West Coast Avengers (1985) #25-37, West Coast Avengers Annual (1986) #2, Avengers Annual (1967) #16, Marvel Graphic Novel (1982) #27: Emperor Doom', [
      range({ title: 'West Coast Avengers', year: 1985, start: 25, end: 37, sourceRangeReference: 'West Coast Avengers (1985) #25-37' }),
      single({ title: 'West Coast Avengers Annual', year: 1986, issueNumber: 2, sourceIssueReference: 'West Coast Avengers Annual #2', sourceRangeReference: 'West Coast Avengers Annual (1986) #2' }),
      single({ title: 'Avengers Annual', year: 1967, issueNumber: 16, sourceIssueReference: 'Avengers Annual #16', sourceRangeReference: 'Avengers Annual (1967) #16' }),
      single({ title: 'Marvel Graphic Novel', year: 1982, issueNumber: 27, sourceIssueReference: 'Marvel Graphic Novel #27', sourceRangeReference: 'Marvel Graphic Novel (1982) #27: Emperor Doom' }),
    ]),
    block(28, 'Collects: West Coast Avengers (1985) #38-46, Avengers West Coast (1989) #47-52, West Coast Avengers Annual (1986) #3, Avengers West Coast Annual (1989) #4, Material From Avengers Spotlight (1989) #23.', [
      range({ title: 'West Coast Avengers', year: 1985, start: 38, end: 46, sourceRangeReference: 'West Coast Avengers (1985) #38-46' }),
      range({ title: 'Avengers West Coast', year: 1989, start: 47, end: 52, sourceRangeReference: 'Avengers West Coast (1989) #47-52' }),
      single({ title: 'West Coast Avengers Annual', year: 1986, issueNumber: 3, sourceIssueReference: 'West Coast Avengers Annual #3', sourceRangeReference: 'West Coast Avengers Annual (1986) #3' }),
      single({ title: 'Avengers West Coast Annual', year: 1989, issueNumber: 4, sourceIssueReference: 'Avengers West Coast Annual #4', sourceRangeReference: 'Avengers West Coast Annual (1989) #4' }),
      single({ title: 'Avengers Spotlight', year: 1989, issueNumber: 23, classification: 'semantic-exclusion', sourceIssueReference: 'Avengers Spotlight #23', sourceRangeReference: 'Material From Avengers Spotlight (1989) #23' }),
    ]),
    block(30, 'Marc Spector, Moon Knight #1 to #60 (1989 to 1994)', [
      range({ title: 'Marc Spector, Moon Knight', year: 1989, start: 1, end: 60, sourceRangeReference: 'Marc Spector, Moon Knight #1 to #60 (1989 to 1994)' }),
    ]),
    block(33, 'Collects: Amazing Spider-Man (1963) #351-360, Amazing Spider-Man Annual #25, Spectacular Spider-Man Annual #11, Web Of Spider-Man Annual #7, And Spider-Man: Fear Itself (1992).', [
      range({ title: 'Amazing Spider-Man', year: 1963, start: 351, end: 360, sourceRangeReference: 'Amazing Spider-Man (1963) #351-360' }),
      single({ title: 'Amazing Spider-Man Annual', year: 1963, issueNumber: 25, sourceIssueReference: 'Amazing Spider-Man Annual #25', sourceRangeReference: 'Amazing Spider-Man Annual #25' }),
      single({ title: 'Spectacular Spider-Man Annual', year: 1979, issueNumber: 11, sourceIssueReference: 'Spectacular Spider-Man Annual #11', sourceRangeReference: 'Spectacular Spider-Man Annual #11' }),
      single({ title: 'Web Of Spider-Man Annual', year: 1985, issueNumber: 7, sourceIssueReference: 'Web Of Spider-Man Annual #7', sourceRangeReference: 'Web Of Spider-Man Annual #7' }),
      namedCandidate({ title: 'Spider-Man: Fear Itself', year: 1992, sourceIssueReference: 'Spider-Man: Fear Itself (1992)', note: 'Named included comic identity without a numeric issue label.' }),
    ]),
    block(36, 'Collects: Moon Knight: Divided We Fall #1', [
      single({ title: 'Moon Knight: Divided We Fall', year: 1992, issueNumber: 1, sourceIssueReference: 'Moon Knight: Divided We Fall #1', sourceRangeReference: 'Moon Knight: Divided We Fall #1' }),
    ]),
    block(41, 'Collects: Marvel Knights (2000) #1-15', [
      range({ title: 'Marvel Knights', year: 2000, start: 1, end: 15, sourceRangeReference: 'Marvel Knights (2000) #1-15' }),
    ]),
  ]),
  group('Modern Moon Knight Reborn (2000 to 2012)', [
    block(45, 'Collects: Moon Knight (2006 to 2009) #1 to #6', [
      range({ title: 'Moon Knight', year: 2006, start: 1, end: 6, sourceRangeReference: 'Moon Knight (2006 to 2009) #1 to #6' }),
    ]),
    block(47, 'Collects: Moon Knight #7 to #13', [
      range({ title: 'Moon Knight', year: 2006, start: 7, end: 13, sourceRangeReference: 'Moon Knight #7 to #13' }),
    ]),
    block(49, 'Collects: Moon Knight #14 to #20', [
      range({ title: 'Moon Knight', year: 2006, start: 14, end: 20, sourceRangeReference: 'Moon Knight #14 to #20' }),
    ]),
    block(51, 'Collects: Moon Knight #21 to #25, Moon Knight: Silent Night One-Shot', [
      range({ title: 'Moon Knight', year: 2006, start: 21, end: 25, sourceRangeReference: 'Moon Knight #21 to #25' }),
      namedCandidate({ title: 'Moon Knight: Silent Knight', sourceIssueReference: 'Moon Knight: Silent Night One-Shot', note: 'The source calls it Silent Night One-Shot; provider series 6361 identifies the one-shot as Moon Knight: Silent Knight.' }),
    ]),
    block(53, 'Collects: Moon Knight (2006 to 2009) #26 to #30', [
      range({ title: 'Moon Knight', year: 2006, start: 26, end: 30, sourceRangeReference: 'Moon Knight (2006 to 2009) #26 to #30' }),
    ]),
    block(55, 'Collects: Vengeance of the Moon Knight #1 to #6', [
      range({ title: 'Vengeance of the Moon Knight', year: 2009, start: 1, end: 6, sourceRangeReference: 'Vengeance of the Moon Knight #1 to #6' }),
    ]),
    block(58, 'Collects: Vengeance of the Moon Knight #7 to #10', [
      range({ title: 'Vengeance of the Moon Knight', year: 2009, start: 7, end: 10, sourceRangeReference: 'Vengeance of the Moon Knight #7 to #10' }),
    ]),
    block(61, 'Collects: Shadowland Moon Knight #1 to #3', [
      range({ title: 'Shadowland Moon Knight', year: 2010, start: 1, end: 3, sourceRangeReference: 'Shadowland Moon Knight #1 to #3' }),
    ]),
  ]),
  group('Moon Knight, Secret Avenger', [
    block(67, 'Collects: Secret Avengers (2010 to 2012) #1 to #5', [
      range({ title: 'Secret Avengers', year: 2010, start: 1, end: 5, sourceRangeReference: 'Secret Avengers (2010 to 2012) #1 to #5' }),
    ]),
    block(69, 'Collects: Secret Avengers (2010 to 2012) #6 to #12', [
      range({ title: 'Secret Avengers', year: 2010, start: 6, end: 12, sourceRangeReference: 'Secret Avengers (2010 to 2012) #6 to #12' }),
    ]),
    block(71, 'Collects: Secret Avengers (2010 to 2012) #16 to #21', [
      range({ title: 'Secret Avengers', year: 2010, start: 16, end: 21, sourceRangeReference: 'Secret Avengers (2010 to 2012) #16 to #21' }),
    ]),
  ]),
  group('Brian Michael Bendis & Alex Maleev Moon Knight', [
    block(79, 'Collects: Moon Knight (2010 to 2012) #1 to #7', [
      range({ title: 'Moon Knight', year: 2011, start: 1, end: 7, sourceRangeReference: 'Moon Knight (2010 to 2012) #1 to #7' }),
    ]),
    block(81, 'Collects: Moon Knight (2010 to 2012) #8 to #12', [
      range({ title: 'Moon Knight', year: 2011, start: 8, end: 12, sourceRangeReference: 'Moon Knight (2010 to 2012) #8 to #12' }),
    ]),
  ]),
  group('Marvel NOW! Moon Knight - The Warren Ellis Run (And More)', [
    block(87, 'Collects: Moon Knight (2012) #1 to #6', [
      range({ title: 'Moon Knight', year: 2014, start: 1, end: 6, sourceRangeReference: 'Moon Knight (2012) #1 to #6' }),
    ]),
    block(89, 'Collects: Moon Knight (2012) #7 to #12', [
      range({ title: 'Moon Knight', year: 2014, start: 7, end: 12, sourceRangeReference: 'Moon Knight (2012) #7 to #12' }),
    ]),
    block(91, 'Collects: Moon Knight (2012) #13 to #17', [
      range({ title: 'Moon Knight', year: 2014, start: 13, end: 17, sourceRangeReference: 'Moon Knight (2012) #13 to #17' }),
    ]),
  ]),
  group('All-New All-Different Moon Knight - The Jeff Lemire Run', [
    block(97, 'Collects: Moon Knight (2016) #1 to #5', [
      range({ title: 'Moon Knight', year: 2016, start: 1, end: 5, sourceRangeReference: 'Moon Knight (2016) #1 to #5' }),
    ]),
    block(99, 'Collects: Moon Knight #6 to #9', [
      range({ title: 'Moon Knight', year: 2016, start: 6, end: 9, sourceRangeReference: 'Moon Knight #6 to #9' }),
    ]),
    block(101, 'Collects: Moon Knight #10 to #14', [
      range({ title: 'Moon Knight', year: 2016, start: 10, end: 14, sourceRangeReference: 'Moon Knight #10 to #14' }),
    ]),
  ]),
  group('Marvel Legacy Moon Knight and Beyond!', [
    block(104, 'Collects: Moon Knight 188-193', [
      range({ title: 'Moon Knight', year: 2016, start: 188, end: 193, sourceRangeReference: 'Moon Knight 188-193', note: 'The source omits a series year; provider series 20488 identifies the legacy-numbered issues as Moon Knight (2016).' }),
    ]),
    block(106, 'Collects: Moon Knight 194-198', [
      range({ title: 'Moon Knight', year: 2016, start: 194, end: 198, sourceRangeReference: 'Moon Knight 194-198', note: 'The source omits a series year; provider series 20488 identifies the legacy-numbered issues as Moon Knight (2016).' }),
    ]),
    block(108, 'Collects: Doctor Strange: Damnation #1-4, Damnation: Johnny Blaze - Ghost Rider #1, Doctor Strange (2015) #386-389, Iron Fist (2017) #78-80 And Ben Reilly: Scarlet Spider #15-17', [
      range({ title: 'Doctor Strange: Damnation', year: 2018, start: 1, end: 4, sourceRangeReference: 'Doctor Strange: Damnation #1-4' }),
      single({ title: 'Damnation: Johnny Blaze - Ghost Rider', year: 2018, issueNumber: 1, sourceIssueReference: 'Damnation: Johnny Blaze - Ghost Rider #1', sourceRangeReference: 'Damnation: Johnny Blaze - Ghost Rider #1' }),
      range({ title: 'Doctor Strange', year: 2015, start: 386, end: 389, sourceRangeReference: 'Doctor Strange (2015) #386-389' }),
      range({ title: 'Iron Fist', year: 2017, start: 78, end: 80, sourceRangeReference: 'Iron Fist (2017) #78-80' }),
      range({ title: 'Ben Reilly: Scarlet Spider', year: 2017, start: 15, end: 17, sourceRangeReference: 'Ben Reilly: Scarlet Spider #15-17' }),
    ]),
    block(111, 'Collects: Contagion (2019) #1-5', [
      range({ title: 'Contagion', year: 2019, start: 1, end: 5, sourceRangeReference: 'Contagion (2019) #1-5' }),
    ]),
    block(114, 'Collects: Conan: Serpent War (2019) #1-4, Supernatural Thrillers (1972) #3', [
      range({ title: 'Conan: Serpent War', year: 2019, start: 1, end: 4, sourceRangeReference: 'Conan: Serpent War (2019) #1-4' }),
      single({ title: 'Supernatural Thrillers', year: 1972, issueNumber: 3, sourceIssueReference: 'Supernatural Thrillers #3', sourceRangeReference: 'Supernatural Thrillers (1972) #3' }),
    ]),
    block(117, 'Collects: Avengers (2018) #31-38', [
      range({ title: 'Avengers', year: 2018, start: 31, end: 38, sourceRangeReference: 'Avengers (2018) #31-38' }),
    ]),
  ]),
  group('Latest Additions:', [
    block(120, 'Collects: Moon Knight (2021) #1-6', [
      range({ title: 'Moon Knight', year: 2021, start: 1, end: 6, sourceRangeReference: 'Moon Knight (2021) #1-6' }),
    ]),
    block(124, "Collects: Moon Knight (2021) #7 to #12, Devil's Reign: Moon Knight", [
      range({ title: 'Moon Knight', year: 2021, start: 7, end: 12, sourceRangeReference: 'Moon Knight (2021) #7 to #12' }),
      namedCandidate({ title: "Devil's Reign: Moon Knight", sourceIssueReference: "Devil's Reign: Moon Knight", note: 'Named included comic identity without a numeric issue label.' }),
    ]),
    block(127, 'Collects: Moon Knight: Black, White & Blood #1 to #4', [
      range({ title: 'Moon Knight: Black, White & Blood', year: 2022, start: 1, end: 4, sourceRangeReference: 'Moon Knight: Black, White & Blood #1 to #4' }),
    ]),
    block(128, 'Ms. Marvel & Moon Knight', [
      namedCandidate({ title: 'Ms. Marvel & Moon Knight', sourceIssueReference: 'Ms. Marvel & Moon Knight', note: 'Named included comic identity without a numeric issue label.' }),
    ]),
    block(129, "Devil's Reign: Moon Knight", [
      namedRepeat({ title: "Devil's Reign: Moon Knight", sourceIssueReference: "Devil's Reign: Moon Knight", note: 'Later source occurrence of the same named comic identity.', repeatOf: 384 }),
    ]),
    block(131, 'Collects: Moon Knight (2021) #13 to #18, Moon Knight Annual 2022 #1', [
      range({ title: 'Moon Knight', year: 2021, start: 13, end: 18, sourceRangeReference: 'Moon Knight (2021) #13 to #18' }),
      single({ title: 'Moon Knight Annual', year: 2022, issueNumber: 1, sourceIssueReference: 'Moon Knight Annual 2022 #1', sourceRangeReference: 'Moon Knight Annual 2022 #1' }),
    ]),
    block(133, 'Collects: Moon Knight (2021) #19 to #24', [
      range({ title: 'Moon Knight', year: 2021, start: 19, end: 24, sourceRangeReference: 'Moon Knight (2021) #19 to #24' }),
    ]),
    block(135, 'Collects: Moon Knight (2021) #25 to #29', [
      range({ title: 'Moon Knight', year: 2021, start: 25, end: 29, sourceRangeReference: 'Moon Knight (2021) #25 to #29' }),
    ]),
    block(137, 'Strange Academy: Moon Knight', [
      namedCandidate({ title: 'Strange Academy: Moon Knight', sourceIssueReference: 'Strange Academy: Moon Knight', note: 'Named included comic identity without a numeric issue label.' }),
    ]),
    block(139, 'Collects: Moon Knight: City of the Dead #1 to #5', [
      range({ title: 'Moon Knight: City of the Dead', year: 2023, start: 1, end: 5, sourceRangeReference: 'Moon Knight: City of the Dead #1 to #5' }),
    ]),
  ]),
]);

export {
  moonKnightSourceLedger,
};
