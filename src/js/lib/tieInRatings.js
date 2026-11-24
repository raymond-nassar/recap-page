import { SECRET_WARS_2015_EVENT_ID } from './catalog.js';

// Comic Book Herald's series ratings of the Secret Wars (2015) tie-ins, approved by the owner on
// 2026-11-24 as three stoplight groups linked to the article. Only the group is recorded: no rank,
// score or review text, and nothing here reorders, hides or counts a comic. Keyed by the
// metadata provider's series id, so a series reaches its group only by exact identity, and only
// inside the one reading the ratings were written for.
export const TIE_IN_RATINGS_SOURCE = Object.freeze({
  name: 'Comic Book Herald',
  url: 'https://www.comicbookherald.com/what-are-the-best-secret-wars-tie-ins-every-series-ranked/',
});

export const TIE_IN_RATING_TIERS = Object.freeze({
  favorite: 'Favorite',
  average: 'Average to good',
  lower: 'Lower rated',
});

// An independent read of the whole article on 2026-11-24 placed all 58 series in these sections, by
// heading boundary only. Two of its entries stay unlabelled on purpose: the core event, which these
// labels are not for, and Howard the Duck, which the article itself says is not a tie-in.
const SERIES_TIERS = Object.freeze({
  favorite: [
    18310, 19689, 19501, 20070, 18407, 20605, 19614, 20261, 19580, 19471, 19632, 19466, 19608, 19348,
    19418, 19497, 19765, 19817, 19350, 19790,
  ],
  average: [
    19591, 19659, 19245, 19160, 20442, 18340, 18468, 19477, 19246, 19470, 19457, 19417, 20269, 19462,
    19625, 19685, 19622, 18572, 20007, 20090, 19456, 19426, 19416, 20093,
  ],
  lower: [
    19658, 19657, 18894, 18138, 19247, 19814, 19661, 19390, 19813, 19244, 19430, 19349, 19284, 19649,
  ],
});

// The rated series' issues that the 2015 guide itself lists and that match a provider issue exactly.
// A series rating says nothing about issues outside the guide: Spider-Woman (2014) #1 shares its
// series with the guide's #10 yet is no tie-in, so a comic reaches its group only by being one of
// these. A row whose identity is still open (the Spider-Island and Journal #5 headings, X-Men '92,
// Korvac Saga #4, Armor Wars #1/2) has no exact match and so is absent until it is resolved.
const GUIDE_ISSUES = Object.freeze(new Set([
  51558, 52048, 52049, 51559, 52250, 52251, 52252, 52253, 55350, 52502, 52050, 52051, 52480, 51202,
  52457, 52482, 52459, 52483, 51204, 52460, 52479, 52484, 51205, 52461, 52462, 51206, 52485, 51207,
  52778, 52989, 51801, 51798, 53710, 53712, 51799, 53713, 51800,
  52067, 52068, 52069, 52070, 52509, 52510, 52207, 51976, 52208, 52375, 51978, 52209, 52377, 51577,
  52281, 51567, 52282, 52378, 51979, 52210, 51568, 52379, 52283, 52380, 51581, 51980, 52284, 51582,
  51981, 52310, 52511,
]));

const RATED = new Map([[SECRET_WARS_2015_EVENT_ID, {
  issues: GUIDE_ISSUES,
  series: new Map(Object.entries(SERIES_TIERS).flatMap(([tier, ids]) => ids.map((id) => [id, tier]))),
}]]);

// A lower-rated tie-in in this reading is also marked Optional. That is this guide's advice, chosen
// by the owner on 2026-11-24, not a claim that the article called the series unnecessary, so it
// stays tied to these ratings rather than becoming a rule for any other guide.
export function tieInRating(catalogId, item) {
  const rated = RATED.get(catalogId);
  if (!rated?.issues.has(Number(item?.issueId))) return null;
  const tier = rated.series.get(Number(item?.seriesId));
  return tier ? { tier, label: TIE_IN_RATING_TIERS[tier], optional: tier === 'lower' } : null;
}

export function hasTieInRatings(catalogId, items) {
  return RATED.has(catalogId) && (Array.isArray(items) ? items : []).some((item) => tieInRating(catalogId, item));
}
