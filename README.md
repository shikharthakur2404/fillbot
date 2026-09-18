# ⚡ FillBot — AI Job Application Autofill

Private Chrome/Edge extension that uses your CV + Gemini AI to intelligently fill **any** job application form — including open-ended free-text questions in any language.

> **100% local** — your CV never leaves your browser. Only the LLM prompt goes to Gemini API directly from your browser using your own API key.

## Features

- **Universal** — works on Siemens, LinkedIn Easy Apply, Workday, Greenhouse, Lever, Google Forms, any custom portal
- **Smart field detection** — reads labels, `aria-label`, `placeholder`, `name` attributes
- **Open-ended questions** — LLM generates tailored answers from your CV (not just name/email)
- **Multilingual** — responds in the language of the form (German form → German answers)
- **Character limit aware** — detects `maxlength` and stays under it automatically
- **React/Angular compatible** — uses native value setter + dispatches `input`/`change` events
- **Review panel** — side panel shows every generated answer with char counter, edit inline before applying

## Install (unpacked — private use)

1. Clone or download this repo
2. Open `chrome://extensions` or `edge://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** → select the `fillbot/` folder
5. Pin FillBot to your toolbar

## Setup

1. Get a free Gemini API key at [aistudio.google.com](https://aistudio.google.com)
2. Click FillBot icon → paste your API key → **Save Key**
3. Paste your CV text → **Save CV**

## Usage

1. Navigate to a job application form
2. Click FillBot → **⚡ Fill This Page**
3. Fields fill with blue highlight — review before submitting
4. Or click **Review in Side Panel →** to edit answers individually

## Stack

- Manifest V3 (Chrome/Edge)
- Gemini 1.5 Flash (via direct REST)
- `chrome.storage.local` for CV/key (device only)
- `chrome.storage.session` for pending answers (side panel sync)
- Zero backend, zero server

## Privacy

Your CV and API key are stored only in `chrome.storage.local` on your device. They are never synced or sent to any server. The only external call is your browser → Gemini API directly, using your own key.
