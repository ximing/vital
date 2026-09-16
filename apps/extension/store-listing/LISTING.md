# Chrome Web Store · first listing (English)

Fill the developer dashboard **in English**. Reviewers are not Chinese speakers. Product UI stays Chinese; that is expected and noted below.

Do not claim features the **0.1.0** package does not have (toolbar popup: article / selection / task / file; context menus; Alt+Shift+V).

This is a **new item** (Add new item), not an update.

---

## 0. Package

```
apps/extension/store-listing/vital-0.1.0-chrome.zip
```

`manifest.json` is at the zip root. Version `0.1.0`. Manifest strings are English.

Rebuild the store package (does not overwrite local `dist/`):

```bash
cd /Users/ximing/project/mygithub/vital
pnpm --filter @vital/extension zip:store
```

Local `build` / `dev` still target localhost. Store build writes `dist-store/` and copies the zip here.

Dashboard: [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole) → **Add new item**.

---

## 1. Store listing

**Language:** English (United States)  
One language only. Do **not** add Chinese as a store locale (the in-product UI is Chinese; the listing is English for review).

### Name (max 45 characters) — 31

```
Vital: Save pages to read later
```

Plain `Vital` also matches the manifest name.

### Summary (max 132 characters) — 118

```
Save the current page, selection, image, or file to your Vital read-later inbox, or as a task. Toolbar or Alt+Shift+V.
```

### Detailed description

```
Vital saves the page you are reading into your Vital read-later inbox. You can also save it as a task, or capture a PDF / audio / video file from the current page into your account.

The in-product UI is Chinese.

How to use
• Click the toolbar icon to preview the title and text, edit the title, add a note, and choose Article, Selection, Task, or File
• Press Alt+Shift+V to save the current page immediately
• Right-click a page, link, selection, or image: save to read later, save as a task, or save and edit
• Open Recent in the popup to see items you just saved

Saves extract a title and readable text so you can finish reading on the Vital website. The same URL is not created twice. Images and files you choose to save are stored in your account. They are not sent to unrelated third parties.

Sign in
The first time, click “Sign in on the web” in the extension, sign in at vital.aimo.plus, and the extension connects automatically. Session tokens stay in your Chrome profile.

This is not an ad blocker and not a crawler. It reads the current tab only when you choose to save.
```

### Category

**Productivity**

### Official URL

Verify `aimo.plus` (or `vital.aimo.plus`) in Google Search Console first. Then:

```
https://vital.aimo.plus
```

### Homepage URL

```
https://vital.aimo.plus
```

### Support URL

```
https://vital.aimo.plus
```

### YouTube promo video

Leave empty.

### Mature content

Do **not** enable. Suitable for all ages.

---

## 2. Graphic assets (`assets/`)

| Field | File | Size | Required |
| --- | --- | --- | --- |
| Store icon | `assets/icon-128.png` | 128 × 128 PNG | Yes |
| Screenshot 1 | `assets/screenshot-1-save.png` | 1280 × 800 | Yes (upload first) |
| Screenshot 2 | `assets/screenshot-2-menu.png` | 1280 × 800 | Recommended |
| Screenshot 3 | `assets/screenshot-3-login.png` | 1280 × 800 | Recommended |
| Screenshot 4 | `assets/screenshot-4-recent.png` | 1280 × 800 | Recommended |
| Screenshot 5 | `assets/screenshot-5-edit.png` | 1280 × 800 | Recommended |
| Small promo | `assets/promo-small-440x280.png` | 440 × 280 | Yes |
| Marquee | `assets/promo-marquee-1400x560.png` | 1400 × 560 | Optional, recommended |
| Large promo | `assets/promo-large-920x680.png` | 920 × 680 | Optional |

Spare: `assets/icon-512.png`

Screenshots (popup chrome is the real Chinese UI):

1. Toolbar popup, article mode  
2. Context menu  
3. Sign-in prompt  
4. Recent saves  
5. In-page toast after Alt+Shift+V  

Promo tiles are English brand banners, not product screenshots.

---

## 3. Privacy practices

### Single purpose

```
When the user chooses, save the current page, link, selected text, image, or file to their Vital read-later inbox or tasks.
```

### Does this extension collect user data?

**Yes.** Only to complete the single purpose above (write into the user’s own Vital account).

Check:

- [x] Personally identifiable information (email, used to sign in)
- [x] Website content (title, article text, selection, images, files, and URL the user chose to save)
- [x] Authentication information (access / refresh tokens in `chrome.storage`)
- [ ] Location
- [ ] Health
- [ ] Financial
- [ ] Personal communications
- [ ] Web history (pages the user did not save are not recorded)
- [ ] User activity (do not extra-check; we do not log unsaved browsing)

### Certifications

- [x] App functionality (save to read later / tasks)
- [ ] Advertising
- [ ] Analytics (no third-party analytics)
- [ ] Selling to third parties → **No**

Also certify:

- [x] I do not sell or transfer user data to third parties, except as necessary to provide the service (Vital API and object storage)
- [x] I do not use or transfer user data for purposes unrelated to this item’s single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending

### Sell user data?

**No.**

### Use for purposes unrelated to the single purpose?

**No.**

### Remote hosted code?

**No.** All scripts ship in the package. Select “No, I am not using remote code.”

### Privacy policy URL

Must be public HTTPS, no login wall:

```
https://vital.aimo.plus/privacy.html
```

Source: `apps/web/public/privacy.html` (kept in sync with `store-listing/privacy.html`). **Deploy the English privacy page before you submit.**

### Permission justifications

Paste one box per permission.

**storage**  
Stores the user’s sign-in tokens and a short profile cache. Not used for cross-site tracking.

**activeTab**  
When the user clicks the toolbar or uses the shortcut, read the current tab’s title, URL, and article text so it can be saved. Other tabs are not read in the background.

**scripting**  
On a user-initiated save, inject a script into the current tab to extract readable text and user-selected images. Only that tab, only for that action.

**contextMenus**  
Adds right-click items to save a page, link, selection, or image, save as a task, or save and edit.

**offscreen**  
Parse article HTML with Readability and convert image formats that cannot be uploaded as-is, inside a hidden extension document. Parsing stays in the local extension process. No third-party parser.

**Host permission `https://vital.aimo.plus/*`**  
Same origin as the Vital API and website. Used to sign in, create read-later items and tasks, and list recent saves.

**Host permission `https://s3.aimo.plus/*`**  
Uploads images and files the user chose to save to the object storage Vital uses. Nothing else is uploaded.

No `localhost` in the store package.

---

## 4. Distribution

- Visibility: **Public**
- Regions: **All regions**
- Price: **Free**
- Mature: off

Uncheck “publish automatically after review” so you can confirm the assigned extension ID and sign-in handoff first.

---

## 5. Test instructions

Reviewers must be able to sign in. Public registration: https://vital.aimo.plus/register  

If you have a dedicated test account, paste it only in the dashboard (not in git):

```
Test email:
Test password:

Steps:
1. Install the extension. Click the toolbar icon. You should see a sign-in prompt (Chinese UI: “连接你的 Vital”).
2. Click the primary button (“在网页登录”) and sign in at vital.aimo.plus with the account above, or register.
3. Open any ordinary http(s) page (not chrome://). Click the toolbar again. You should see title / note and Article · Selection · Task · File.
4. Click Save (保存). You should see a saved state; “在 Vital 中打开” opens the item.
5. Right-click the page. You should see “保存到 Vital” and “保存为待办到 Vital”.
6. Alt+Shift+V saves the current page immediately (check chrome://extensions/shortcuts if the key is taken).
```

---

## 6. Reviewer Q&A

**Why scripting + activeTab?**  
Saving an article requires reading the DOM. Injection happens only on click or shortcut. The extension does not request `tabs` to scan every tab.

**Why not `<all_urls>` as a required host permission?**  
Required hosts are only the Vital API and storage. The current page uses activeTab. Saving an article may prompt for optional access to image CDNs so those files can be copied into Vital instead of hotlinked (WeChat returns a stub image when the reader origin is sent as Referer).

**How does this relate to the Vital app?**  
Same product, browser capture entry. The extension only brings content in. Reading, tasks, and reviews live at vital.aimo.plus.

**Why does sign-in open the website?**  
The extension has no email/password form. After website login, a one-time code is handed to the extension via `externally_connectable`.

---

## 7. Checklist

- [ ] Zip root is `manifest.json`, version `0.1.0`
- [ ] Store `host_permissions` are only `https://vital.aimo.plus/*` and `https://s3.aimo.plus/*`
- [ ] `externally_connectable` is only `https://vital.aimo.plus/*`
- [ ] Privacy policy URL opens in Incognito and is **English**
- [ ] Listing language is English; summary/description match the package
- [ ] Screenshots show the current popup (article / selection / task / file)
- [ ] Store icon matches extension `icon-128.png`
