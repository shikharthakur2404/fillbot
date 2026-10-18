# Security notes (FillBot)

## Permissions

- Required `host_permissions` is limited to `https://generativelanguage.googleapis.com/*` (Gemini REST API only).
- There is no required `<all_urls>` host permission and no always-on content script.
- Page access uses `activeTab` + `scripting.executeScript` when you click **Fill This Page** (popup) or apply/clear from the side panel.
- `optional_host_permissions` (`http://*/*`, `https://*/*`) is a fallback: if `activeTab` is not enough (for example after navigation while the side panel is open), Chrome may prompt once for that site’s origin. Declining keeps the extension from scripting that page.
- CV text and the Gemini API key stay in `chrome.storage.local` on this device. The only network call is to Gemini when generating answers (unless you use a DEMO/PORTFOLIO key, which stays offline).

## Why not required `<all_urls>`

Job boards live on many domains. Declaring required `<all_urls>` would restore always-on injection and standing access to every site. On-demand scripting plus optional per-origin grants covers autofill without that default.
