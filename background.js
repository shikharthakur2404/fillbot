// ============================================================
// FILLBOT — BACKGROUND SERVICE WORKER (background.js)
// ============================================================
// WHAT IS THIS FILE?
//   The "brain" of the extension. It runs silently in the
//   background, separate from any webpage. Its only job here
//   is to call the Gemini API and return answers.
//
// WHY A SERVICE WORKER?
//   Manifest V3 replaced persistent background pages with
//   service workers. They're ephemeral — Chrome kills them
//   after ~30s of inactivity to save memory, then restarts
//   them on the next event. Rule: NEVER store state in a
//   variable here. Use chrome.storage instead.
//
// MESSAGE FLOW:
//   popup.js → [chrome.runtime.sendMessage] → background.js
//            → [Gemini REST API] → background.js
//            → [sendResponse] → popup.js
// ============================================================

// chrome.runtime.onMessage: listens for messages from ANY
// part of the extension (popup, content script, side panel)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

  if (message.type === 'GENERATE_ANSWERS') {

    // We use an IIFE (immediately invoked async function) because
    // the onMessage listener itself can't be async — Chrome needs
    // the return value synchronously to know if we'll call
    // sendResponse later. Returning `true` keeps the channel open.
    (async () => {
      try {
        // Read the API key + CV that the user saved in the popup.
        // chrome.storage.local = stored on this device only, never synced.
        const { apiKey, cvText } = await chrome.storage.local.get(['apiKey', 'cvText']);

        if (!apiKey) {
          sendResponse({ error: 'No Gemini API key saved. Open FillBot popup to add one.' });
          return;
        }
        if (!cvText) {
          sendResponse({ error: 'No CV saved. Open FillBot popup to add your CV.' });
          return;
        }

        const fields = message.fields; // Array of {fillId, label, type, charLimit}
        if (!fields || fields.length === 0) {
          sendResponse({ error: 'No fields to fill.' });
          return;
        }

        // Call Gemini and get back a {fillId → answer} map
        const answers = await callGemini(apiKey, cvText, fields);

        // Also push to session storage so the side panel can
        // display the answers for review (session = cleared on browser close)
        await chrome.storage.session.set({
          pendingAnswers: answers,
          pendingFields: fields,
        });

        sendResponse({ answers });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();

    // IMPORTANT: return true here to tell Chrome "I will call
    // sendResponse asynchronously". Without this, Chrome closes
    // the message channel immediately and sendResponse does nothing.
    return true;
  }
});

// ─── Gemini API Call ──────────────────────────────────────────────────────────
// Builds a prompt, calls the Gemini REST API, parses the JSON response.
//
// WHY REST AND NOT THE SDK?
//   Extensions can't use npm packages without a build step.
//   Direct fetch() to the REST API keeps things zero-dependency.
//
// WHICH MODEL?
//   gemini-1.5-flash — fast and cheap. Good enough for form filling.
//   (gemini-1.5-pro would be more accurate but slower + costs more)
// ─────────────────────────────────────────────────────────────────────────────
async function callGemini(apiKey, cvText, fields) {

  // Build a text description of each field for the prompt
  const fieldDescriptions = fields
    .map((f) => {
      const limitNote = f.charLimit ? ` (max ${f.charLimit} characters — MUST NOT exceed)` : '';
      const typeNote = f.type === 'textarea' ? ' [long answer]' : ' [short answer]';
      return `Field ID: ${f.fillId}\nLabel: ${f.label}${typeNote}${limitNote}`;
    })
    .join('\n\n');

  // The prompt is the core of everything.
  // We tell Gemini exactly what format to respond in (JSON),
  // and give it strict rules about character limits and language.
  const prompt = `You are helping a job applicant fill out an online job application form.
Below is the applicant's CV and context. Fill in each form field accurately and concisely based on the CV.

IMPORTANT RULES:
- Respond ONLY with a valid JSON object mapping field IDs to answer strings.
- Never exceed the character limit for any field. If a limit is given, count carefully and stay under it.
- Match the language of the field label (e.g., if the label is in German, answer in German).
- For standard fields (name, email, phone, address), extract directly from the CV.
- For open-ended questions, write a concise, honest, tailored answer using the CV.
- If you cannot answer a field from the CV, return an empty string "".
- Do NOT include any explanation, only the JSON object.

APPLICANT CV / CONTEXT:
${cvText}

FORM FIELDS TO FILL:
${fieldDescriptions}

Respond with ONLY this JSON format:
{
  "fillbot-0": "answer here",
  "fillbot-1": "answer here",
  ...
}`;

  // Make the actual HTTP request to Gemini's REST API.
  // The API key goes in the URL as a query param (Google's pattern for browser clients).
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,   // Low = more factual, less creative. Good for forms.
          maxOutputTokens: 2048,
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err?.error?.message || `Gemini API error ${response.status}`);
  }

  // Gemini response structure:
  // { candidates: [{ content: { parts: [{ text: "..." }] } }] }
  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Gemini sometimes wraps JSON in markdown code fences like ```json ... ```
  // Strip those before parsing
  const jsonText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    return JSON.parse(jsonText); // → { "fillbot-0": "Shikhar Thakur", ... }
  } catch {
    throw new Error(`Could not parse Gemini response as JSON. Raw: ${rawText.substring(0, 200)}`);
  }
}
