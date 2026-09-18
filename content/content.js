// ============================================================
// FILLBOT — CONTENT SCRIPT (content/content.js)
// ============================================================
// WHAT IS THIS FILE?
//   A content script runs INSIDE the webpage you're visiting.
//   It has access to the page's DOM (HTML elements) and can
//   read, modify, and inject content into the page.
//
// HOW IS IT DIFFERENT FROM background.js?
//   background.js = lives in the extension, talks to APIs.
//   content.js    = lives in the webpage, touches form fields.
//   They communicate via chrome.runtime.sendMessage / onMessage.
//
// THREE JOBS:
//   1. SCAN  — find all fillable form fields and extract metadata
//   2. FILL  — inject answers into the correct fields
//   3. TOAST — show a confirmation banner on the page
// ============================================================

(function () {
  // Guard against double-injection.
  // Chrome may inject this script multiple times on some SPAs.
  if (window.__fillbotInjected) return;
  window.__fillbotInjected = true;

  // Visual style for filled fields
  const HIGHLIGHT_COLOR = 'rgba(125, 211, 252, 0.15)';
  const HIGHLIGHT_BORDER = '2px solid #7dd3fc';

  // ─── 1. FIELD SCANNER ───────────────────────────────────────────────────────
  // Finds the human-readable label for a form field.
  // Job application forms use many different patterns, so we try 6 strategies.

  function getLabel(el) {
    // Strategy 1: <label for="fieldId"> explicitly linked to this input
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) return label.innerText.trim();
    }

    // Strategy 2: The input is INSIDE a <label> element
    // e.g. <label>Email <input type="text"/></label>
    const parentLabel = el.closest('label');
    if (parentLabel) return parentLabel.innerText.replace(el.value || '', '').trim();

    // Strategy 3: aria-label attribute (used by React/Angular component libraries)
    // e.g. <input aria-label="Your email address" />
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();

    // Strategy 4: aria-labelledby points to another element's ID
    // e.g. <input aria-labelledby="q1-label"> ... <span id="q1-label">Question</span>
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return labelEl.innerText.trim();
    }

    // Strategy 5: placeholder text as a hint (last text resort)
    if (el.placeholder) return el.placeholder.trim();

    // Strategy 6: name or id attribute (least descriptive, but better than nothing)
    return el.name || el.id || '';
  }

  // Extract the character limit from the field (if any)
  // maxlength="500" means Gemini must stay under 500 chars
  function getCharLimit(el) {
    const maxlength = el.getAttribute('maxlength');
    if (maxlength && parseInt(maxlength) > 0) return parseInt(maxlength);
    return null;
  }

  // Classify the field type so Gemini knows short vs long answer
  function getFieldType(el) {
    if (el.tagName === 'TEXTAREA') return 'textarea'; // Long text box
    if (el.tagName === 'SELECT') return 'select';     // Dropdown
    const type = (el.type || 'text').toLowerCase();
    if (['text', 'email', 'tel', 'url', 'search', 'number'].includes(type)) return 'text';
    return type;
  }

  // Main scanner: finds all visible, editable form fields on the page
  function scanFields() {
    // CSS selector that catches all common input types
    // We exclude hidden, submit, button, file, checkbox, radio
    // (those need different handling — MVP focuses on text inputs)
    const selector = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea, select';
    const elements = [...document.querySelectorAll(selector)];

    return elements
      .filter((el) => {
        // Skip invisible or disabled fields
        const style = window.getComputedStyle(el);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          !el.disabled &&
          !el.readOnly
        );
      })
      .map((el, idx) => {
        const label = getLabel(el);
        if (!label) return null; // Can't fill a field we can't describe to Gemini

        // Tag the element with a unique ID so we can find it again when filling
        const fillId = `fillbot-${idx}`;
        el.dataset.fillbotId = fillId;

        return {
          fillId,
          label,         // "Describe your Python skills"
          type: getFieldType(el),
          charLimit: getCharLimit(el), // e.g. 500
          currentValue: el.value || '',
          tagName: el.tagName,
        };
      })
      .filter(Boolean); // Remove nulls (fields with no label)
  }

  // ─── 2. FIELD FILLER ────────────────────────────────────────────────────────
  // Fills a single field with the given answer.
  //
  // WHY THE NATIVE VALUE SETTER TRICK?
  //   React, Vue, Angular track input values via their own internal state.
  //   If you just do `el.value = "something"`, their state doesn't update
  //   and the form appears filled but internally registers as empty.
  //
  //   The trick: use the ORIGINAL browser setter (before React overwrote it)
  //   then fire 'input' and 'change' events — this makes React/Angular think
  //   the user typed the value themselves.

  function fillField(fillId, answer) {
    const el = document.querySelector(`[data-fillbot-id="${fillId}"]`);
    if (!el) return;

    // Enforce character limit (Gemini should already respect it, but double-check)
    const limit = getCharLimit(el);
    const value = limit ? answer.substring(0, limit) : answer;

    // Get the original (pre-React) value setter from the prototype chain
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype,
      'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value); // Set via original setter
    } else {
      el.value = value; // Fallback for non-React pages
    }

    // Fire events so React/Vue/Angular update their internal state
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    // Visual highlight so the user can see what was filled
    el.style.outline = HIGHLIGHT_BORDER;
    el.style.backgroundColor = HIGHLIGHT_COLOR;
    el.style.transition = 'all 0.3s ease';
  }

  // Remove the blue highlights (used by side panel "Clear" button)
  function clearHighlights() {
    document.querySelectorAll('[data-fillbot-id]').forEach((el) => {
      el.style.outline = '';
      el.style.backgroundColor = '';
    });
  }

  // ─── 3. TOAST NOTIFICATION ──────────────────────────────────────────────────
  // Shows a floating banner at the bottom-right of the page.
  // Injected directly into the page's DOM — no permission needed.

  function showToast(message, type = 'success') {
    // Remove any existing toast first
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

    // Inject animation keyframes (only once)
    const style = document.createElement('style');
    style.textContent = `
      @keyframes fillbot-fadein {
        from { opacity: 0; transform: translateY(10px); }
        to   { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(toast);

    // Auto-dismiss after 4 seconds
    setTimeout(() => toast.remove(), 4000);
  }

  // ─── MESSAGE LISTENER ───────────────────────────────────────────────────────
  // The content script listens for commands from the popup and side panel.
  // Think of this as the content script's "API".

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

    // SCAN_FIELDS: popup asks "what fields are on this page?"
    if (message.type === 'SCAN_FIELDS') {
      const fields = scanFields();
      sendResponse(fields); // Send the array of field metadata back
      return true;
    }

    // FILL_FIELDS: popup/sidepanel sends {fillId: answer} map → fill them
    if (message.type === 'FILL_FIELDS') {
      const answers = message.answers;
      let filled = 0;

      // requestAnimationFrame: waits for the browser to be ready to paint
      // before doing DOM changes — avoids janky/blocking behavior
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

      return true; // async response
    }

    // CLEAR_HIGHLIGHTS: side panel "Clear" button removes the blue outlines
    if (message.type === 'CLEAR_HIGHLIGHTS') {
      clearHighlights();
      sendResponse({ ok: true });
      return true;
    }
  });

})(); // IIFE — wrapping everything in a function avoids polluting the page's global scope
