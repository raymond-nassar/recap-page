import { labelledName } from '../../lib/accname.js';
import { TIE_IN_RATINGS_SOURCE, tieInRating } from '../../lib/tieInRatings.js';

// The words carry the rating; the color behind them only repeats it, so a reader with colors off
// or forced still reads the same label.
export function tieInRatingLabels(el, catalogId, item) {
  const rating = tieInRating(catalogId, item);
  if (!rating) return null;
  return el('span', { class: 'tie-in-labels' }, [
    el('span', { class: `badge rating-badge rating-${rating.tier}`, text: rating.label }),
    rating.optional ? el('span', { class: 'badge badge-optional', text: 'Optional' }) : null,
  ]);
}

export function tieInRatingCredit(el) {
  return el('p', { class: 'edition-credit rating-credit' }, [el('a', {
    href: TIE_IN_RATINGS_SOURCE.url, target: '_blank', rel: 'noopener noreferrer',
    'aria-label': labelledName('Rated by Comic Book Herald', 'opens outside Recap Page'),
    text: 'Rated by Comic Book Herald',
  })]);
}
