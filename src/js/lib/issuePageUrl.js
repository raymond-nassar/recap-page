const ISSUE_PAGE = /^https:\/\/(?:www\.)?marvel\.com\/comics\/issue\/([1-9]\d{0,11})(?:\/[A-Za-z0-9][A-Za-z0-9_-]{0,199})?\/?$/;

export function issuePageUrl(value, issueId) {
  if (typeof value !== 'string' || value.length > 500) return null;
  if ((typeof issueId !== 'number' && typeof issueId !== 'string')
    || !/^[1-9]\d{0,11}$/.test(String(issueId))) return null;
  const match = ISSUE_PAGE.exec(value);
  if (!match || match[1] !== String(issueId)) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['marvel.com', 'www.marvel.com'].includes(url.hostname)
    || url.username || url.password || url.port || url.search || url.hash || url.href !== value) return null;
  return value;
}
