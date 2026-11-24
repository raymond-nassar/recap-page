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

const SERIES_TIERS = Object.freeze({
  favorite: [
    18310, 19689, 19501, 20070, 18407, 20605, 19614, 20261, 19580, 19471,
    19632, 19466, 19608, 19348, 19418, 19497, 19765, 19817, 19350, 19790,
  ],
  average: [
    19591, 19659, 19245, 19160, 20442, 18340, 18468, 19477, 19246, 19470, 19457, 19417,
    20269, 19462, 19625, 19685, 19622, 18572, 20007, 20090, 19456, 19426, 19416, 20093,
  ],
  lower: [
    19658, 19657, 18894, 18138, 19247, 19814, 19661, 19390, 19813, 19244, 19430, 19349, 19284, 19649,
  ],
});

const RATED = new Map([[SECRET_WARS_2015_EVENT_ID, new Map(Object.entries(SERIES_TIERS)
  .flatMap(([tier, ids]) => ids.map((id) => [id, tier])))]]);

// A lower-rated tie-in in this reading is also marked Optional. That is this guide's advice, chosen
// by the owner on 2026-11-24, not a claim that the article called the series unnecessary, so it
// stays tied to these ratings rather than becoming a rule for any other guide.
export function tieInRating(catalogId, item) {
  const tier = RATED.get(catalogId)?.get(Number(item?.seriesId));
  return tier ? { tier, label: TIE_IN_RATING_TIERS[tier], optional: tier === 'lower' } : null;
}

export function hasTieInRatings(catalogId, items) {
  return RATED.has(catalogId) && (Array.isArray(items) ? items : []).some((item) => tieInRating(catalogId, item));
}
