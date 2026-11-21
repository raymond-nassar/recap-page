export function offlineActionLabel(offlineState, idleLabel = 'Make available offline') {
  const state = offlineState?.state || 'idle';
  if (state === 'checking') return 'Checking offline availability...';
  if (state === 'preparing') return offlineState?.cancelling ? 'Cancelling...' : 'Preparing offline copy...';
  if (state === 'ready') return 'Refresh offline copy';
  if (state === 'stale') return 'Update offline copy';
  if (state === 'failed' || state === 'cancelled') return 'Try again';
  if (state === 'unsupported') return 'Offline preparation unavailable';
  return idleLabel;
}

export function offlineStatusText(offlineState, { published = false, isIos = false } = {}) {
  if (!offlineState) return '';
  const subject = published ? 'this published order' : 'this Reading List';
  // A check that did not finish established nothing, so no state is claimed.
  if (offlineState.state === 'unchecked') return '';
  if (published && offlineState.state === 'check-failed') {
    return "We couldn't check whether this published order is ready offline. Reopen Reading List options to check again.";
  }
  if (offlineState.state === 'checking') return `Checking whether ${subject} is ready offline.`;
  if (offlineState.state === 'busy') {
    return 'The app is already preparing an offline copy. Reopen Reading List options to check again.';
  }
  if (offlineState.state === 'preparing') {
    const progress = offlineState.progress;
    if (offlineState.cancelling) return 'Cancelling offline preparation...';
    if (!progress) {
      return published ? 'Saving this published order for offline use.' : `Preparing and verifying ${subject} for offline use.`;
    }
    const verb = progress.phase === 'write' ? 'Verified' : 'Fetched';
    return `${verb} ${progress.completed} of ${progress.total} offline files.`;
  }
  if (offlineState.state === 'ready') return 'Offline copy verified and ready on this device.';
  if (offlineState.state === 'stale') return offlineState.reason || 'The offline copy needs an update.';
  if (offlineState.state === 'unsupported') {
    if (isIos) return 'Offline preparation is not available in this app.';
    return (!published && offlineState.error) || 'Offline preparation is not supported in this browser.';
  }
  if (offlineState.state === 'cancelled') return 'Preparation cancelled. Any earlier completed offline copy is unchanged.';
  if (offlineState.state === 'failed') {
    if (published || offlineState.code === 'unconfirmed') return "We couldn't confirm the offline copy. Try again.";
    return `Offline preparation failed: ${offlineState.error || 'The copy could not be verified.'}`;
  }
  return `${published ? 'This published order' : 'This Reading List'} is not saved for offline use.`;
}
