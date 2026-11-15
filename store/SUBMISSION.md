# Chrome Web Store submission: Task Colors for Google Calendar

Everything the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) asks for, in its order. Paste the text blocks as they are.

## Before you start
- [ ] **Host the privacy policy.** Upload `store/privacy-policy.html` somewhere public: your own website, GitHub Pages, or any static host. First replace `[YOUR CONTACT EMAIL OR SUPPORT PAGE]` near the bottom. You'll paste its URL in the **Privacy** tab.
- [ ] **Build the package** (already built for 1.0.0): `python3 scripts/package.py` → `dist/task-colors-for-google-calendar-1.0.0.zip`

---

## 1. Package
Dashboard → **Add new item** → upload `dist/task-colors-for-google-calendar-1.0.0.zip`.

The name, summary, version and icons come from `manifest.json`:
- **Name:** Task Colors for Google Calendar
- **Summary:** Color your Google Tasks on Google Calendar by list, or give any single task its own color.

---

## 2. Store listing tab

**Description**
```
Google Calendar shows every task in the same color. Task Colors for Google Calendar lets you color tasks by task list, or give any single task its own color, so you can tell work, school and personal to-dos apart at a glance.

COLOR BY LIST
Open the Tasks panel in Google Calendar and click the color button next to the list name. Every task in that list takes on the color, in day, week and month views.

COLOR A SINGLE TASK
Click a task on your calendar, then click the color circle at the top left of its details. A task's own color overrides its list color, and "Default" switches it back.

FAMILIAR COLORS
Choose from the same 24 colors Google Calendar uses for events, or pick any custom color.

EVERYTHING IN ONE PLACE
The toolbar popup lists all your task lists and tasks. Search tasks, set colors, or switch coloring off with one click.

PRIVATE BY DESIGN
• No sign-in and no access to your Google account
• No servers, analytics, ads or tracking
• Your colors and task names stay in your browser and are never sent anywhere
• Runs only on calendar.google.com and tasks.google.com

Task Colors for Google Calendar is an independent extension and is not affiliated with, endorsed by, or sponsored by Google. Google Calendar and Google Tasks are trademarks of Google LLC.
```

| Field | Value |
|---|---|
| Category | Productivity → **Workflow & Planning** |
| Language | English |
| Store icon (128×128) | `store/images/store-icon-128.png` |
| Screenshots (1280×800), in this order | `store/images/screenshot-1-color-by-list.png`<br>`store/images/screenshot-2-task-color.png`<br>`store/images/screenshot-3-tasks-panel.png`<br>`store/images/screenshot-4-popup.png` |
| Small promo tile (440×280) | `store/images/promo-small-440x280.png` |
| Marquee promo tile (1400×560), optional | `store/images/promo-marquee-1400x560.png` |
| Homepage URL / Support URL | Optional: your site or a support page, if you have one |
| Mature content | No |

The screenshots show the extension's real color menu, buttons and popup. The calendar backgrounds are simplified illustrations. To add a real screenshot of your own Calendar, take it at 1280×800 and replace or add to these.

---

## 3. Privacy tab

**Single purpose description**
```
Colors Google Tasks on Google Calendar: tasks are colored by their task list, and users can give individual tasks their own color.
```

**Permission justification: `storage`**
```
Saves the user's color choices (per task list and per task) and a local copy of their task list names and task titles, so tasks can be colored on Google Calendar. Everything is stored locally with chrome.storage.local and never leaves the device.
```

**Host permission justification** (the content scripts on calendar.google.com and tasks.google.com)
```
The extension's single purpose happens on these two sites. On calendar.google.com it recolors task chips and adds a color button to a task's details. On tasks.google.com (the Tasks side panel embedded in Google Calendar) it adds a color button next to the list name. On both, it reads the task data the page already loads (task IDs, titles and list membership) to know which list each task belongs to. It runs on no other sites.
```

**Are you using remote code?** → **No, I am not using remote code.** All JavaScript ships inside the package.

**Data usage: what user data do you collect?**
- [x] **Website content.** The extension reads task titles and task list names from the Google Calendar and Tasks pages. Chrome Web Store policy requires disclosing data the extension handles, even when it stays on the device.
- Leave every other category unchecked.

**Certifications:** check all three:
- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** the public URL where you hosted `store/privacy-policy.html`.

---

## 4. Distribution tab
| Field | Value |
|---|---|
| Payments | Free |
| Visibility | **Public**, or **Unlisted** for a soft launch (only people with the link can find it) |
| Distribution | All regions |

---

## 5. Test instructions tab (for the reviewer)
```
No special account or credentials needed; any Google account works.

1. Sign in to a Google account and open https://calendar.google.com
2. Open the Tasks panel (right-hand side panel → Tasks). Create two task lists and add a task with today's date to each. The tasks appear on the calendar grid.
3. Color by list: in the Tasks panel header, click the "● ▾" button to the right of the list name ("My Tasks ▾") and choose a color. That list's tasks on the calendar change to the color.
4. Color one task: click a task on the calendar. In its details popup, click the "● ▾" circle at the top left and choose a color. Only that task changes. "Default" switches it back to the list color.
5. The toolbar popup (active only on calendar.google.com and tasks.google.com) lists all lists and tasks, lets you set colors, and has an on/off switch.

Technical notes: the extension reads the task data Google Calendar already loads into the page. A page-world script (src/inject.js) observes the page's own AF_initDataCallback data and fetch/XHR responses without modifying them. It makes no network requests of its own and uses no Google APIs. All data is kept in chrome.storage.local.
```

---

## 6. Submit
Click **Submit for review**. Reviews usually take a few days. Extensions that read page content can take longer.

---

## Releasing an update later
1. Bump `"version"` in `manifest.json` (for example 1.0.0 → 1.0.1).
2. `python3 scripts/package.py`
3. Dashboard → your item → **Package** → **Upload new package** → submit for review.

To change the store images, edit `store/images/src/screens.html` and re-render. See the comment at the top of `scripts/render-store-images.js`.
