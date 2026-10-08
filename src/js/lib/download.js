// true confirms native output; requested means only that a browser download was asked for.
let handler = browserDownload;

export function setDownloadHandler(next) {
  if (typeof next !== 'function') throw new TypeError('A download handler is required.');
  handler = next;
}

export async function saveDownload(filename, text, type) {
  const result = await handler({ filename, text, type });
  return result === true || result === 'requested' ? result : false;
}

export function downloadMessage(result, name) {
  return result === true ? `${name} downloaded.` : `${name} download requested. Check your browser's downloads to confirm it was saved.`;
}

export function browserDownload({ filename, text, type }) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  try {
    a.click();
  } finally {
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return 'requested';
}
