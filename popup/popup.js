const apiKeyInput = document.getElementById('api-key-input');
const saveKeyBtn = document.getElementById('save-key-btn');
const keyStatus = document.getElementById('key-status');
const cvInput = document.getElementById('cv-input');
const saveCvBtn = document.getElementById('save-cv-btn');
const cvStatus = document.getElementById('cv-status');
const fillBtn = document.getElementById('fill-btn');
const openPanelBtn = document.getElementById('open-panel-btn');
const fillStatus = document.getElementById('fill-status');

// Load saved values on open
async function init() {
  const { apiKey, cvText } = await chrome.storage.local.get(['apiKey', 'cvText']);

  if (apiKey) {
    apiKeyInput.value = '•'.repeat(20);
    keyStatus.textContent = '✓ Key saved';
  }

  if (cvText) {
    cvInput.value = cvText;
    cvStatus.textContent = '✓ CV saved';
  }

  updateFillButton(apiKey, cvText);
}

function updateFillButton(apiKey, cvText) {
  fillBtn.disabled = !(apiKey && cvText);
}

// Save API key
saveKeyBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key || key.startsWith('•')) {
    keyStatus.textContent = '⚠ Enter a new key to update';
    keyStatus.style.color = '#f59e0b';
    return;
  }
  await chrome.storage.local.set({ apiKey: key });
  apiKeyInput.value = '•'.repeat(20);
  keyStatus.textContent = '✓ Key saved';
  keyStatus.style.color = '#22c55e';

  const { cvText } = await chrome.storage.local.get('cvText');
  updateFillButton(key, cvText);
});

// Save CV
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

// Fill this page
fillBtn.addEventListener('click', async () => {
  fillBtn.disabled = true;
  document.getElementById('fill-btn-text').textContent = '⏳ Scanning fields…';
  fillStatus.textContent = '';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Inject content script manually (in case it hasn't run yet on restricted pages)
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/content.js']
    });
  } catch (_) {
    // already injected — ignore
  }

  // Ask content script to scan fields
  chrome.tabs.sendMessage(tab.id, { type: 'SCAN_FIELDS' }, async (fields) => {
    if (chrome.runtime.lastError || !fields || fields.length === 0) {
      fillStatus.textContent = '⚠ No fillable fields found on this page';
      fillStatus.style.color = '#f59e0b';
      resetFillBtn();
      return;
    }

    document.getElementById('fill-btn-text').textContent = `⚙ Generating ${fields.length} answers…`;

    // Send to background to call Gemini
    chrome.runtime.sendMessage({ type: 'GENERATE_ANSWERS', fields }, (response) => {
      if (chrome.runtime.lastError || !response || response.error) {
        fillStatus.textContent = `✗ ${response?.error || 'Gemini API error'}`;
        fillStatus.style.color = '#ef4444';
        resetFillBtn();
        return;
      }

      // Send answers to content script to fill
      chrome.tabs.sendMessage(tab.id, { type: 'FILL_FIELDS', answers: response.answers }, () => {
        fillStatus.textContent = `✓ Filled ${Object.keys(response.answers).length} fields`;
        fillStatus.style.color = '#22c55e';
        resetFillBtn();
      });
    });
  });
});

// Open side panel
openPanelBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.sidePanel.open({ windowId: tab.windowId });
  window.close();
});

function resetFillBtn() {
  fillBtn.disabled = false;
  document.getElementById('fill-btn-text').textContent = '⚡ Fill This Page';
}

init();
