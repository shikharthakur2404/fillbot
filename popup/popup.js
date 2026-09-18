// ============================================================
// FILLBOT — POPUP (popup/popup.js)
// ============================================================
// WHAT IS THIS FILE?
//   The popup is what appears when you click the extension icon.
//   It's a tiny webpage (popup.html) that lives inside the extension.
//   This JS file handles all the interactivity in that popup.
//
// POPUP LIFETIME:
//   The popup is destroyed every time you close it (click away).
//   So we NEVER store state in variables — always read from
//   chrome.storage and write back to it immediately.
//
// POPUP'S THREE JOBS:
//   1. Setup  — let user save their Gemini API key + CV
//   2. Trigger — "Fill This Page" button kicks off the whole flow
//   3. Bridge  — coordinates between content script and background
// ============================================================

const apiKeyInput  = document.getElementById('api-key-input');
const saveKeyBtn   = document.getElementById('save-key-btn');
const keyStatus    = document.getElementById('key-status');
const cvInput      = document.getElementById('cv-input');
const saveCvBtn    = document.getElementById('save-cv-btn');
const cvStatus     = document.getElementById('cv-status');
const fillBtn      = document.getElementById('fill-btn');
const openPanelBtn = document.getElementById('open-panel-btn');
const fillStatus   = document.getElementById('fill-status');

// ── Init: load saved values when popup opens ─────────────────
// Every time the popup opens, we read from chrome.storage.local
// and pre-fill the UI so the user knows what's already saved.

async function init() {
  const { apiKey, cvText } = await chrome.storage.local.get(['apiKey', 'cvText']);

  if (apiKey) {
    apiKeyInput.value = '•'.repeat(20); // Show masked dots, not the real key
    keyStatus.textContent = '✓ Key saved';
  }

  if (cvText) {
    cvInput.value = cvText;
    cvStatus.textContent = '✓ CV saved';
  }

  // Only enable the Fill button if BOTH key and CV are saved
  updateFillButton(apiKey, cvText);
}

function updateFillButton(apiKey, cvText) {
  fillBtn.disabled = !(apiKey && cvText);
}

// ── Save API Key ─────────────────────────────────────────────
// Stores the key in chrome.storage.local (device-only, not synced).
// Then masks it with dots so it's not visible.

saveKeyBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();

  // If the field shows dots, the user didn't change it — skip
  if (!key || key.startsWith('•')) {
    keyStatus.textContent = '⚠ Enter a new key to update';
    keyStatus.style.color = '#f59e0b';
    return;
  }

  await chrome.storage.local.set({ apiKey: key });
  apiKeyInput.value = '•'.repeat(20); // Mask after saving
  keyStatus.textContent = '✓ Key saved';
  keyStatus.style.color = '#22c55e';

  const { cvText } = await chrome.storage.local.get('cvText');
  updateFillButton(key, cvText);
});

// ── Save CV ──────────────────────────────────────────────────
saveCvBtn.addEventListener('click', async () => {
  const text = cvInput.value.trim();

  if (!text) {
    cvStatus.textContent = '⚠ CV is empty';
    cvStatus.style.color = '#f59e0b';
    return;
  }

  await chrome.storage.local.set({ cvText: text });
  cvStatus.textContent = '✓ CV saved';
  cvStatus.style.color = '#22c55e';

  const { apiKey } = await chrome.storage.local.get('apiKey');
  updateFillButton(apiKey, text);
});

// ── Fill This Page ───────────────────────────────────────────
// This is the main action. The flow is:
//
//   popup → content.js: "scan the page, give me all field metadata"
//   popup → background.js: "call Gemini with the fields + CV"
//   popup → content.js: "here are the answers, fill the fields"
//
// We go through the popup (not directly content↔background) because
// only the popup can reliably get the active tab and coordinate timing.

fillBtn.addEventListener('click', async () => {
  fillBtn.disabled = true;
  document.getElementById('fill-btn-text').textContent = '⏳ Scanning fields…';
  fillStatus.textContent = '';

  // Get the currently active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Try to inject content.js again — it may not have run on restricted pages
  // or pages that loaded before the extension was installed. Errors are safe to ignore.
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/content.js']
    });
  } catch (_) {
    // Already injected — ignore the error
  }

  // Step 1: Ask content.js to scan the page for form fields
  chrome.tabs.sendMessage(tab.id, { type: 'SCAN_FIELDS' }, async (fields) => {
    if (chrome.runtime.lastError || !fields || fields.length === 0) {
      fillStatus.textContent = '⚠ No fillable fields found on this page';
      fillStatus.style.color = '#f59e0b';
      resetFillBtn();
      return;
    }

    document.getElementById('fill-btn-text').textContent = `⚙ Generating ${fields.length} answers…`;

    // Step 2: Send fields to background.js → Gemini API
    // background.js has access to the API key (from storage) and returns answers
    chrome.runtime.sendMessage({ type: 'GENERATE_ANSWERS', fields }, (response) => {
      if (chrome.runtime.lastError || !response || response.error) {
        fillStatus.textContent = `✗ ${response?.error || 'Gemini API error'}`;
        fillStatus.style.color = '#ef4444';
        resetFillBtn();
        return;
      }

      // Step 3: Send the answers back to content.js to fill the fields
      chrome.tabs.sendMessage(tab.id, { type: 'FILL_FIELDS', answers: response.answers }, () => {
        fillStatus.textContent = `✓ Filled ${Object.keys(response.answers).length} fields`;
        fillStatus.style.color = '#22c55e';
        resetFillBtn();
      });
    });
  });
});

// ── Open Side Panel ──────────────────────────────────────────
// Opens Chrome's native side panel (right side of browser)
// so the user can review and edit answers before applying.

openPanelBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.sidePanel.open({ windowId: tab.windowId });
  window.close(); // Close the popup (side panel is now open)
});

// Reset the fill button back to its default state
function resetFillBtn() {
  fillBtn.disabled = false;
  document.getElementById('fill-btn-text').textContent = '⚡ Fill This Page';
}

// Run init when the popup opens
init();
