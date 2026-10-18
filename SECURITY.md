# Security notes (FillBot)

## Permissions

- `host_permissions` is limited to `https://generativelanguage.googleapis.com/*` (Gemini REST API only).
- There is no `<all_urls>` host permission and no always-on content script.
- Page access uses `activeTab` + `scripting.executeScript` when you click **Fill This Page** (popup) or apply/clear from the side panel. Autofill therefore requires a user gesture on the tab you intend to fill.
- CV text and the Gemini API key stay in `chrome.storage.local` on this device. The only network call is to Gemini when generating answers (unless you use a DEMO/PORTFOLIO key, which stays offline).

## Why not broader host access

Job boards live on many domains. Declaring `<all_urls>` would restore always-on injection but is unnecessary: on-demand scripting covers the product without granting standing access to every site.
