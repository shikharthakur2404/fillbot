// Side Panel JS — review and apply generated answers

let currentAnswers = null;
let currentFields = null;

const noAnswers = document.getElementById('no-answers');
const answersContainer = document.getElementById('answers-container');
const fieldsList = document.getElementById('fields-list');
const applyAllBtn = document.getElementById('apply-all-btn');
const clearBtn = document.getElementById('clear-btn');

// Load any previously generated answers from storage
async function init() {
  const { pendingAnswers, pendingFields } = await chrome.storage.session.get([
    'pendingAnswers',
    'pendingFields',
  ]);

  if (pendingAnswers && pendingFields) {
    renderFields(pendingFields, pendingAnswers);
  }
}

// Listen for new answers pushed from background
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.pendingAnswers || changes.pendingFields) {
    chrome.storage.session.get(['pendingAnswers', 'pendingFields'], ({ pendingAnswers, pendingFields }) => {
      if (pendingAnswers && pendingFields) {
        renderFields(pendingFields, pendingAnswers);
      }
    });
  }
});

function renderFields(fields, answers) {
  currentAnswers = { ...answers };
  currentFields = fields;

  fieldsList.innerHTML = '';
  noAnswers.style.display = 'none';
  answersContainer.style.display = 'flex';

  fields.forEach((field) => {
    const answer = answers[field.fillId] || '';

    const card = document.createElement('div');
    card.className = 'field-card';
    card.dataset.fillId = field.fillId;

    const labelEl = document.createElement('div');
    labelEl.className = 'field-label-text';
    labelEl.textContent = field.label;

    const textarea = document.createElement('textarea');
    textarea.className = 'field-answer';
    textarea.value = answer;
    textarea.rows = field.type === 'textarea' ? 4 : 2;

    const meta = document.createElement('div');
    meta.className = 'field-meta';

    const charCount = document.createElement('span');
    charCount.className = 'char-count';
    updateCharCount(charCount, answer.length, field.charLimit);

    const applyOneBtn = document.createElement('button');
    applyOneBtn.className = 'apply-one-btn';
    applyOneBtn.textContent = 'Apply ↗';
    applyOneBtn.addEventListener('click', async () => {
      const val = textarea.value;
      currentAnswers[field.fillId] = val;
      await applyToPage({ [field.fillId]: val });
      applyOneBtn.textContent = '✓ Applied';
      applyOneBtn.style.color = '#22c55e';
      applyOneBtn.style.borderColor = '#22c55e';
    });

    meta.appendChild(charCount);
    meta.appendChild(applyOneBtn);

    textarea.addEventListener('input', () => {
      currentAnswers[field.fillId] = textarea.value;
      updateCharCount(charCount, textarea.value.length, field.charLimit);
    });

    card.appendChild(labelEl);
    card.appendChild(textarea);
    card.appendChild(meta);
    fieldsList.appendChild(card);
  });
}

function updateCharCount(el, length, limit) {
  if (!limit) {
    el.textContent = `${length} chars`;
    el.className = 'char-count';
    return;
  }
  el.textContent = `${length} / ${limit}`;
  if (length > limit) {
    el.className = 'char-count over';
  } else if (length > limit * 0.9) {
    el.className = 'char-count warn';
  } else {
    el.className = 'char-count';
  }
}

async function applyToPage(answers) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { type: 'FILL_FIELDS', answers }, resolve);
  });
}

applyAllBtn.addEventListener('click', async () => {
  if (!currentAnswers) return;
  await applyToPage(currentAnswers);
  applyAllBtn.textContent = '✓ All Applied!';
  setTimeout(() => { applyAllBtn.textContent = '✓ Apply All'; }, 2000);
});

clearBtn.addEventListener('click', async () => {
  await chrome.storage.session.remove(['pendingAnswers', 'pendingFields']);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_HIGHLIGHTS' });
  fieldsList.innerHTML = '';
  answersContainer.style.display = 'none';
  noAnswers.style.display = 'flex';
  currentAnswers = null;
  currentFields = null;
});

init();
