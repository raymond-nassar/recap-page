// Android waits for the document provider; browsers retain their ordinary download behavior.
let handler = browserDownload;

export function setDownloadHandler(next) {
  if (typeof next !== 'function') throw new TypeError('A download handler is required.');
  handler = next;
}

export async function saveDownload(filename, text, type) {
  return await handler({ filename, text, type }) === true;
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
  return true;
}
