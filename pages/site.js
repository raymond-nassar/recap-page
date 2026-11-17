const demo = document.querySelector('[data-guided-demo]');
const platformPicker = document.querySelector('#platform-picker');

if (demo) {
  const guidedTour = demo.closest('.guided-tour');
  const frame = demo.querySelector('[data-tour-frame]');
  const expand = document.querySelector('[data-tour-expand]');
  const start = document.querySelector('[data-tour-start]');
  const reset = document.querySelector('[data-tour-reset]');
  const status = document.querySelector('[data-tour-status]');
  let loadingTimer;
  start.hidden = false;
  demo.hidden = true;

  function loadDemo() {
    clearTimeout(loadingTimer);
    demo.hidden = false;
    start.disabled = true;
    status.textContent = 'Loading the real app with temporary sample data...';
    frame.src = './demo.html';
    reset.hidden = false;
    expand.hidden = false;
    loadingTimer = setTimeout(() => {
      status.textContent = 'The demo could not load. Use Reset demo to try again; the feature examples below are still available.';
      start.disabled = false;
    }, 20000);
  }
  start.addEventListener('click', loadDemo);
  reset.addEventListener('click', loadDemo);
  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow || event.origin !== 'null') return;
    if (event.data?.type === 'recap-demo-ready') {
      clearTimeout(loadingTimer);
      if (document.activeElement === start) frame.focus();
      start.hidden = true;
      start.disabled = false;
      status.textContent = 'Sample ready. Choose a list inside the app. No saved reading data is accessed.';
    } else if (event.data?.type === 'recap-demo-error') {
      clearTimeout(loadingTimer);
      status.textContent = 'The demo could not start. Use Reset demo to try again.';
      start.disabled = false;
    } else if (event.data?.type === 'recap-demo-install') {
      document.querySelector('#get-started').scrollIntoView();
      platformPicker.focus({ preventScroll: true });
    }
  });
  expand.addEventListener('click', () => {
    const expanded = expand.getAttribute('aria-expanded') !== 'true';
    guidedTour.classList.toggle('is-expanded', expanded);
    expand.setAttribute('aria-expanded', String(expanded));
    expand.textContent = expanded ? 'Collapse demo' : 'Expand demo';
  });
}

if (platformPicker) {
  const platformCards = document.querySelectorAll('[data-platform]');
  platformPicker.addEventListener('change', () => {
    for (const card of platformCards) {
      card.hidden = platformPicker.value !== 'all' && card.dataset.platform !== platformPicker.value;
    }
  });
}
