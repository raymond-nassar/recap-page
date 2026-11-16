import {
  coverageMatches, coverageText, DEFAULT_LINK_FILTER, linkFilter, providerPhrase, readLinkFilter,
  saveLinkFilter, storyCoverage,
} from '../../lib/libraryLinks.js';

const COVERAGE_CHOICES = Object.freeze([
  ['off', 'All'],
  ['any', 'Has checked library links'],
  ['every', 'Every comic has a checked link'],
]);
const PROVIDER_CHOICES = Object.freeze([
  ['either', 'Either'],
  ['hoopla', 'Hoopla'],
  ['libby', 'Libby'],
]);

export const PAGE_LINK_TEXT = 'See every Reading List with checked library links';

export const LENDING_NOTE = 'Lending depends on your library. Book pages open outside Recap Page, need internet, and are not live lending checks.';

// The phrase every result sentence on a filtered page ends with, so the announced count, the empty
// result and the visible summary all describe the same narrowing.
export function linkNarrowing(filter) {
  const { coverage, provider } = linkFilter(filter);
  if (coverage === 'off') return '';
  const who = providerPhrase(provider);
  return coverage === 'every'
    ? ` where every comic has a checked ${who} link`
    : ` with at least one checked ${who} link`;
}

export function linkFilterSummary(filter, noun = 'Reading Lists') {
  const phrase = linkNarrowing(filter);
  return phrase ? `Showing ${noun}${phrase}.` : '';
}

// What one page needs from the current choice: whether it narrows, which cards it keeps, and the
// count each kept card shows. Each card counts the list it opens, on every page, so a card's count
// never depends on other readings of its story or on what the page's other narrowing left (owner
// ruling on #1333, revising decision 3).
export function linkNarrower(filter) {
  const links = linkFilter(filter);
  const linking = links.coverage !== 'off';
  const count = (story) => storyCoverage(story.lists, links.provider);
  return {
    links,
    linking,
    narrowing: linkNarrowing(links),
    keep: (story) => !linking || coverageMatches(count(story), links.coverage),
    linkText: linking ? (story) => coverageText(count(story), links.provider) : null,
  };
}

// One remembered choice for every browsing page on this device (decision 8). It lives under its own
// key, which no backup, restore or cloud copy names, so restoring reading data leaves it alone
// (decision 9). The Library links category always filters, so it offers no Off. Its coverage choice
// is held in memory only: saving it would turn filtering on for every other page, where filtering is
// opt-in. Its provider choice is saved like any other.
export function createLibraryLinkFilter({ el, storage, key, pageLink = null }) {
  let filter = readLinkFilter(storage, key);
  let alwaysCoverage = 'any';
  const mounts = new Map();

  function effective(id) {
    const mount = mounts.get(id);
    return mount?.always ? { ...filter, coverage: alwaysCoverage } : { ...filter };
  }

  function choose(id, next, { silent = false } = {}) {
    if (mounts.get(id)?.always) {
      const { coverage, ...saved } = next;
      if (coverage && coverage !== 'off') alwaysCoverage = coverage;
      if (Object.keys(saved).length) filter = saveLinkFilter(storage, key, { ...filter, ...saved });
    } else {
      filter = saveLinkFilter(storage, key, { ...filter, ...next });
    }
    paint(id);
    if (!silent) mounts.get(id)?.onChange?.(effective(id));
  }

  function radios(id, group, choices, value, onPick) {
    return choices.map(([choice, label]) => el('label', { class: 'fp' }, [
      el('input', {
        type: 'radio',
        name: `${id}-links-${group}`,
        value: choice,
        checked: choice === value,
        onchange: () => onPick(choice),
      }),
      el('span', { text: label }),
    ]));
  }

  function paint(id) {
    const mount = mounts.get(id);
    if (!mount?.container) return;
    const current = effective(id);
    const coverageChoices = mount.always ? COVERAGE_CHOICES.filter(([choice]) => choice !== 'off') : COVERAGE_CHOICES;
    const focused = mount.container.contains(globalThis.document?.activeElement)
      ? globalThis.document.activeElement : null;
    const refocus = focused?.name ? { name: focused.name, value: focused.value } : null;
    const active = current.coverage !== 'off';
    mount.container.replaceChildren(
      el('fieldset', { class: 'filters link-filters' }, [
        el('legend', { class: 'filter-legend', text: 'Library links' }),
        ...radios(id, 'coverage', coverageChoices, current.coverage, (coverage) => choose(id, { coverage })),
      ]),
      el('fieldset', { class: 'filters link-filters', hidden: !active }, [
        el('legend', { class: 'filter-legend', text: 'Book links from' }),
        ...radios(id, 'provider', PROVIDER_CHOICES, current.provider, (provider) => choose(id, { provider })),
      ]),
      el('div', { class: 'link-filter-summary', hidden: !active }, [
        el('p', { text: `${linkFilterSummary(current, mount.noun)} ${LENDING_NOTE}` }),
        ...(mount.always ? [] : [el('button', {
          type: 'button',
          class: 'btn btn-g',
          text: `Show all ${mount.noun}`,
          onclick: () => reset(id, { focus: true }),
        })]),
      ]),
      // Stays visible with filtering off, since it is the page's only way in (#1333).
      ...(mount.always || !pageLink ? [] : [el('p', { class: 'link-filter-more' }, [pageLink(PAGE_LINK_TEXT)])]),
    );
    if (refocus) {
      const again = [...mount.container.querySelectorAll('input')]
        .find((input) => input.name === refocus.name && input.value === refocus.value);
      again?.focus();
    }
  }

  // Reset clears only the coverage, so the remembered provider is still there when filtering is
  // turned on again. Focus moves to the first coverage choice, since the summary holding the button
  // is gone.
  function reset(id, { focus = false, silent = false } = {}) {
    choose(id, { coverage: DEFAULT_LINK_FILTER.coverage }, { silent });
    if (focus) mounts.get(id)?.container?.querySelector('input')?.focus();
  }

  function mount(id, container, { noun = 'Reading Lists', always = false, onChange = null } = {}) {
    mounts.set(id, { container, noun, always, onChange });
    paint(id);
  }

  return {
    current: (id) => effective(id),
    mount,
    paint,
    reset,
    reload() { filter = readLinkFilter(storage, key); },
  };
}
