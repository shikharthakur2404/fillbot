// FillBot Content Script
// Scans forms, fills fields, shows highlight overlay

(function () {
  // Avoid double-injection
  if (window.__fillbotInjected) return;
  window.__fillbotInjected = true;

  const HIGHLIGHT_COLOR = 'rgba(125, 211, 252, 0.15)';
  const HIGHLIGHT_BORDER = '2px solid #7dd3fc';

  // ─── Field Scanner ───────────────────────────────────────────────────────────

  function getLabel(el) {
    // 1. Explicit <label for="">
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) return label.innerText.trim();
    }
    // 2. Wrapping <label>
    const parentLabel = el.closest('label');
    if (parentLabel) return parentLabel.innerText.replace(el.value || '', '').trim();
    // 3. aria-label
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
    // 4. aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return labelEl.innerText.trim();
    }
    // 5. placeholder
    if (el.placeholder) return el.placeholder.trim();
    // 6. name attribute as last resort
    return el.name || el.id || '';
  }

  function getCharLimit(el) {
    const maxlength = el.getAttribute('maxlength');
    if (maxlength && parseInt(maxlength) > 0) return parseInt(maxlength);
    return null;
  }

  function getFieldType(el) {
    if (el.tagName === 'TEXTAREA') return 'textarea';
    if (el.tagName === 'SELECT') return 'select';
    const type = (el.type || 'text').toLowerCase();
    if (['text', 'email', 'tel', 'url', 'search', 'number'].includes(type)) return 'text';
    return type;
  }

  function scanFields() {
    const selector = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea, select';
    const elements = [...document.querySelectorAll(selector)];

    return elements
      .filter((el) => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && !el.disabled && !el.readOnly;
      })
      .map((el, idx) => {
        const label = getLabel(el);
        if (!label) return null;
        // Assign a stable ID for targeting
        const fillId = `fillbot-${idx}`;
        el.dataset.fillbotId = fillId;
        return {
          fillId,
          label,
          type: getFieldType(el),
          charLimit: getCharLimit(el),
          currentValue: el.value || '',
          tagName: el.tagName,
        };
      })
      .filter(Boolean);
  }

  // ─── Field Filler ─────────────────────────────────────────────────────────────

  function fillField(fillId, answer) {
    const el = document.querySelector(`[data-fillbot-id="${fillId}"]`);
    if (!el) return;

    // Truncate to char limit
    const limit = getCharLimit(el);
    const value = limit ? answer.substring(0, limit) : answer;

    // Simulate native input events so React/Vue state updates
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
      'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    // Highlight
    el.style.outline = HIGHLIGHT_BORDER;
    el.style.backgroundColor = HIGHLIGHT_COLOR;
    el.style.transition = 'all 0.3s ease';
  }

  function clearHighlights() {
    document.querySelectorAll('[data-fillbot-id]').forEach((el) => {
      el.style.outline = '';
      el.style.backgroundColor = '';
    });
  }

  // ─── Toast ────────────────────────────────────────────────────────────────────

  function showToast(message, type = 'success') {
    const existing = document.getElementById('fillbot-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'fillbot-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: ${type === 'success' ? '#0f172a' : '#1c0505'};
      border: 1px solid ${type === 'success' ? '#7dd3fc' : '#ef4444'};
      color: ${type === 'success' ? '#7dd3fc' : '#ef4444'};
      padding: 12px 20px;
      border-radius: 8px;
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: 13px;
      font-weight: 600;
      z-index: 2147483647;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      letter-spacing: 0.3px;
      animation: fillbot-fadein 0.3s ease;
    `;
    toast.textContent = message;

    const style = document.createElement('style');
    style.textContent = `@keyframes fillbot-fadein { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`;
    document.head.appendChild(style);

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  // ─── Message Listener ─────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'SCAN_FIELDS') {
      const fields = scanFields();
      sendResponse(fields);
      return true;
    }

    if (message.type === 'FILL_FIELDS') {
      const answers = message.answers;
      let filled = 0;

      requestAnimationFrame(() => {
        for (const [fillId, answer] of Object.entries(answers)) {
          if (answer) {
            fillField(fillId, answer);
            filled++;
          }
        }
        showToast(`⚡ FillBot filled ${filled} fields — review before submitting`);
        sendResponse({ filled });
      });

      return true;
    }

    if (message.type === 'CLEAR_HIGHLIGHTS') {
      clearHighlights();
      sendResponse({ ok: true });
      return true;
    }
  });
})();
