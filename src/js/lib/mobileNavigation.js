export function shouldRevealMobileNavigation(previous, current) {
  return Boolean(previous && current && (
    current.size !== previous.size
    || current.scrollY !== previous.scrollY
    || (current.zoomed && current.offset !== previous.offset)
  ));
}
