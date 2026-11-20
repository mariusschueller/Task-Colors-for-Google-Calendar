# Task Colors for Google Calendar

A Chrome extension that colors Google Tasks on Google Calendar. You can color tasks by **list**, and give any task its own **custom color**.

## Install (unpacked)
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Open or reload [Google Calendar](https://calendar.google.com).

## Use
- **Color a list:** in Calendar's Tasks side panel, click the **● ▾** button next to the list name ("My Tasks ▾") and pick a color. On [tasks.google.com](https://tasks.google.com), every list column has the same button next to its name. Or click the toolbar icon, open a list under *Lists*, and pick there.
- **Color one task:** click the task on Calendar, then click the **● ▾** button at the top left of its details popup. You can also search for it under *Tasks* in the toolbar popup. **Default** removes the custom color.
- A custom task color takes priority over its list's color. Tasks whose list has no color keep Google's default color.

## How it works
- The toolbar button is only active on `calendar.google.com` and `tasks.google.com`. On other sites it's grayed out. The page's content script tells `src/background.js` when it's on one of those sites.
- No Google sign-in or API key is needed. `src/inject.js` reads the task data Google already loads into the page (`AF_initDataCallback` blobs and RPC responses), and `src/parser.js` finds the list and task records by their shape.
- `src/background.js` stores the lists and tasks it finds in `chrome.storage.local` (`taskIndex`). Colors are saved there too (`listColors`, `taskColors`, `enabled`).
- `src/content.js` matches each Calendar chip (`[data-eventid]`) to a task id with `getTaskIdFromChip`, then writes one `<style>` element that recolors the matched chips.

## Troubleshooting
Google sometimes changes Calendar's internals. If tasks don't get colored:
0. After changing any extension file, click the reload icon on the extension in `chrome://extensions`, **then reload the Calendar tab**. Already-open tabs keep the old scripts.
   On a Calendar tab, the popup's **Copy diagnostics** button copies a JSON report covering which data sources were seen, which ids are cached, and what task chips look like.
1. In the popup, check **Debug logging** and reload Calendar.
2. Open DevTools on Calendar and filter the console by `[rcc]`.
   - If you see no `found … tasks` lines, the data capture broke. Look for a new payload shape in the Network tab and update `src/parser.js`.
   - If you see `found` lines but no `chip … -> …` lines, the chip-to-task matching broke. Inspect a task chip and compare its `data-eventid` with the ids in `taskIndex`, then update `getTaskIdFromChip` / `idCandidates` in `src/content.js`. The popup's status line also lists chips that look like tasks but didn't match.

## Publishing
- `python3 scripts/package.py` builds the Chrome Web Store upload zip in `dist/`.
- `store/SUBMISSION.md` has every Developer Dashboard field, with text ready to paste.
- `store/images/` holds the store icon, screenshots and promo tiles. Their source is `store/images/src/screens.html`, rendered by `scripts/render-store-images.js`.
- `store/privacy-policy.html` is the privacy policy to host publicly.
