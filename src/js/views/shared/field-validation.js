export function wireFieldValidation({ field, reportId, reportError, invalidMessage }) {
  const described = new Set((field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
  described.add(reportId);
  field.setAttribute('aria-describedby', [...described].join(' '));

  function clear() {
    field.removeAttribute('aria-invalid');
  }

  function fail(message) {
    reportError(message);
    field.setAttribute('aria-invalid', 'true');
    for (let parent = field.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS') parent.open = true;
    }
    field.focus();
  }

  field.addEventListener('input', clear);
  field.addEventListener('invalid', (event) => {
    event.preventDefault();
    fail(invalidMessage);
  });
  return { clear, fail };
}
