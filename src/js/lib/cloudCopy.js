// Protocol errors remain platform-neutral internally, including the record identity checked during
// recovery. Only their displayed text changes, retaining any operation's consequence after the error.
const DEVICE_ERRORS = [
  ['Cloud backup is not turned on for this browser, so nothing was uploaded.', 'Cloud backup is not turned on, so nothing was uploaded.'],
  ['This browser could not keep its cloud backup record.', 'Recap Page could not keep its cloud backup record.'],
  ["This browser's cloud backup record cannot be read.", "Recap Page's cloud backup record cannot be read."],
  ['A backup with this number was already in the account, perhaps made by a device restored from this one, so this browser now starts its backups afresh, and this one will be made again.', 'A backup with this number was already in the account, perhaps made by a device restored from this one, so Recap Page now starts its backups afresh, and this one will be made again.'],
  ['This browser cannot make random ids, so cloud backup is unavailable here.', 'Cloud backup cannot work on this device, because it cannot make random ids.'],
  ['This browser cannot compress or check cloud backups, so cloud backup is unavailable here.', 'Cloud backup cannot work on this device, because it cannot compress or check backups.'],
  ['This browser could not forget its cloud backup record.', 'Recap Page could not forget its cloud backup record.'],
];

export function cloudErrorText(message, scope) {
  if (scope !== 'device' || typeof message !== 'string') return message;
  for (const [windows, android] of DEVICE_ERRORS) {
    if (message === windows || message.startsWith(`${windows} `)) return android + message.slice(windows.length);
  }
  return message;
}
