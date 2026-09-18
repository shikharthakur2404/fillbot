// FillBot Service Worker
// Handles Gemini API calls — all state persisted in chrome.storage

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GENERATE_ANSWERS') {
    (async () => {
      try {
        const { apiKey, cvText } = await chrome.storage.local.get(['apiKey', 'cvText']);

        if (!apiKey) {
          sendResponse({ error: 'No Gemini API key saved. Open FillBot popup to add one.' });
          return;
        }
        if (!cvText) {
          sendResponse({ error: 'No CV saved. Open FillBot popup to add your CV.' });
          return;
        }

        const fields = message.fields;
        if (!fields || fields.length === 0) {
          sendResponse({ error: 'No fields to fill.' });
          return;
        }

        const answers = await callGemini(apiKey, cvText, fields);

        // Push to session storage so side panel can display for review
        await chrome.storage.session.set({
          pendingAnswers: answers,
          pendingFields: fields,
        });

        sendResponse({ answers });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true; // keep message channel open for async
  }
});

// ─── Gemini API Call ──────────────────────────────────────────────────────────

async function callGemini(apiKey, cvText, fields) {
  const fieldDescriptions = fields
    .map((f) => {
      const limitNote = f.charLimit ? ` (max ${f.charLimit} characters — MUST NOT exceed)` : '';
      const typeNote = f.type === 'textarea' ? ' [long answer]' : ' [short answer]';
      return `Field ID: ${f.fillId}\nLabel: ${f.label}${typeNote}${limitNote}`;
    })
    .join('\n\n');

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

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2048,
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err?.error?.message || `Gemini API error ${response.status}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Strip markdown code fences if present
  const jsonText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    return JSON.parse(jsonText);
  } catch {
    throw new Error(`Could not parse Gemini response as JSON. Raw: ${rawText.substring(0, 200)}`);
  }
}
