// These are the title, number and year rules used for the owner's first offline export import.
const HEADER = 'issue_id,series_id,series_title,title,issue_number,issue_sort,publication_date,url,sort_order';
const normalTitle = (text) => String(text).toLowerCase().replace(/\u2019/g, "'")
  .replace(/&/g, ' and ').replace(/^the\s+/, '').replace(/\bthe\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const seriesBase = (text) => String(text || '').replace(/\s*\(\d{4}[^)]*\)\s*$/, '').trim();
const normalNumber = (text) => {
  const number = String(text).trim().replace(/^#/, '');
  return /^-?\d+$/.test(number) ? String(parseInt(number, 10)) : number.toLowerCase();
};
const key = (series, number) => `${normalTitle(series)}#${normalNumber(number)}`;

export function parseExportCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let closed = false;
  const input = text.replace(/^\ufeff/, '');
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (input[i + 1] === '"') { field += '"'; i += 1; }
      else { quoted = false; closed = true; }
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field);
      field = '';
      closed = false;
      if (c !== ',') {
        if (c === '\r' && input[i + 1] === '\n') i += 1;
        rows.push(row);
        row = [];
      }
    } else if (c === '"' && !field && !closed) {
      quoted = true;
    } else {
      if (closed || c === '"') throw new Error('Malformed export CSV quoting');
      field += c;
    }
  }
  if (quoted) throw new Error('Unclosed export CSV quote');
  if (field || row.length || closed) rows.push([...row, field]);
  if (rows.shift()?.join(',') !== HEADER) throw new Error('Unknown export CSV header');
  const headers = HEADER.split(',');
  const numbers = new Set();
  return rows.map((cells, i) => {
    if (cells.length !== headers.length) throw new Error(`Malformed export row ${i + 2}`);
    const record = Object.fromEntries(headers.map((name, at) => [name, cells[at]]));
    const date = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(record.publication_date);
    if (!/^[1-9]\d{0,8}$/.test(record.issue_id) || numbers.has(record.issue_id)
      || record.url !== `https://www.marvelcomicsapp.com/viewer/${record.issue_id}` || !date) {
      throw new Error(`Invalid export identity, viewer address or date at row ${i + 2}`);
    }
    const parsedDate = new Date(Date.UTC(+date[3], +date[1] - 1, +date[2]));
    if (parsedDate.getUTCFullYear() !== +date[3] || parsedDate.getUTCMonth() !== +date[1] - 1
      || parsedDate.getUTCDate() !== +date[2]) throw new Error(`Invalid export date at row ${i + 2}`);
    numbers.add(record.issue_id);
    return record;
  });
}

export function matchExportCsv(text, items) {
  const index = new Map();
  const seen = new Set();
  for (const item of items) {
    if (!Number.isInteger(item.issueId) || item.issueId <= 0 || seen.has(item.issueId)) continue;
    seen.add(item.issueId);
    const k = key(seriesBase(item.seriesName), item.number);
    index.set(k, [...(index.get(k) ?? []), item]);
  }
  return parseExportCsv(text).map((record) => {
    const result = { status: 'unmatched', appLinks: [record.url] };
    const parsed = /^(.*?)\s*#\s*([^\s#]+)\s*$/.exec(`${seriesBase(record.series_title)} #${record.issue_number}`);
    if (!record.issue_number || !parsed) return result;
    const series = parsed[1].replace(/\s+Vol\.?\s*\d+\b/i, '').replace(/\s+/g, ' ').trim();
    const candidates = index.get(key(series, parsed[2])) ?? [];
    const year = +record.publication_date.slice(-4);
    const saleYear = (item) => /^(\d{4})/.exec(String(item.onSale ?? ''))?.[1];
    const exact = candidates.filter((item) => +saleYear(item) === year);
    if (exact.length === 1) return { ...result, status: 'exact', issueId: exact[0].issueId };
    if (exact.length > 1) return { ...result, status: 'ambiguous' };
    const shifted = candidates.filter((item) => +saleYear(item) + 1 === year
      && +String(item.onSale).slice(5, 7) >= 9);
    return shifted.length === 1
      ? { ...result, status: 'ambiguous', ambiguity: 'cover-year-shift', issueId: shifted[0].issueId }
      : result;
  });
}
