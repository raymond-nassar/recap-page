export function uiIcon(name, className = 'gi', documentRef = document) {
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = documentRef.createElementNS(namespace, 'svg');
  icon.setAttribute('class', className);
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  const use = documentRef.createElementNS(namespace, 'use');
  use.setAttribute('href', `./icons/ui.svg#${name}`);
  icon.append(use);
  return icon;
}
