# 1965-Menu

A digital cafeteria menu for 1965 that is accessible for all.

Students open one link on their phone or laptop to see every station's menu, prices, today's hours, a live "open / closed" badge, and calorie calculators for the Deli and Grill. Kitchen managers can mark items **Sold Out**, change prices, and publish updates from any browser.

The whole site is four plain files. There is nothing to install, build, or host besides GitHub Pages.

| File | What it does |
| --- | --- |
| `index.html` | The page layout. Loads Tailwind CSS and Lucide icons from a CDN. |
| `app.js` | All behavior: menu display, live status badge, calculators, and the Kitchen Manager editor. |
| `menu.json` | All the data: hours, stations, items, prices, calories, allergens, and Sold Out status. |
| `README.md` | This guide. |

---

## Part 1: Put the menu online with GitHub Pages (one time, about 2 minutes)

You need to be an owner or admin of this repository.

1. Go to the repository on GitHub: `https://github.com/OwenGachuhi/1965-Menu`.
2. Click the **Settings** tab (gear icon, top of the page).
3. In the left sidebar, under **Code and automation**, click **Pages**.
4. Under **Build and deployment**, find **Source** and choose **Deploy from a branch**.
5. Under **Branch**, choose **`main`** in the first dropdown and **`/ (root)`** in the second dropdown.
6. Click **Save**.
7. Wait 1–2 minutes, then refresh the Pages settings screen. A box at the top will say **"Your site is live at …"**. For this repository the link is:

   **https://owengachuhi.github.io/1965-Menu/**

8. Share that link with students (QR code on a poster, school website, announcements, etc.).

> Tip: If the link shows a 404 at first, wait another minute. You can watch progress in the **Actions** tab, where a run called **pages build and deployment** appears after every change.

---

## Part 2: Kitchen Manager setup (one time per manager)

To publish changes, the editor needs a **GitHub Personal Access Token**. Think of it as a key that only opens this one repository and only lets the holder change files.

### Step A: Create a Fine-Grained Personal Access Token

1. Sign in to GitHub with an account that has write access to this repository.
2. Click your **profile picture** (top-right) → **Settings**.
3. Scroll to the bottom of the left sidebar → **Developer settings**.
4. Click **Personal access tokens** → **Fine-grained tokens**.
5. Click **Generate new token**.
6. Fill in the form:
   - **Token name:** `Cafeteria Menu Editor`
   - **Expiration:** pick a date (for example, the end of the school year). You will make a new token when it expires.
   - **Resource owner:** the account that owns the repository (`OwenGachuhi`).
   - **Repository access:** choose **Only select repositories**, then pick **`1965-Menu`**.
7. Under **Permissions → Repository permissions**, find **Contents** (if you see an **Add permissions** button, click it and pick **Contents**) and set it to **Read and write**.
   GitHub adds **Metadata: Read-only** automatically. Do not add any other permissions.
8. Click **Generate token** at the bottom.
9. **Copy the token now** (it starts with `github_pat_`). GitHub only shows it once. If you lose it, delete it and make a new one.

### Step B: Log in to the Kitchen Manager editor

1. Open the menu site (`https://owengachuhi.github.io/1965-Menu/`).
2. Scroll to the very bottom and click **Kitchen Manager Login**.
3. Fill in the form:
   - **Admin Passcode:** `kitchen2026` (change it later, see Part 4).
   - **Repository:** filled in for you as `owengachuhi/1965-Menu`. Leave it.
   - **Branch:** `main`.
   - **GitHub Personal Access Token:** paste the token from Step A.
   - **Remember token on this device:** check this only on **your own** phone or computer so you never have to paste it again. Leave it unchecked on shared computers.
4. Click **Unlock Editor**. The **Kitchen Manager Dashboard** opens.

---

## Part 3: Everyday use (marking items Sold Out and publishing)

1. Open the site → **Kitchen Manager Login** (or **Dashboard** at the top if you are still logged in).
2. Pick a station tab at the top of the dashboard (for example **Olive Branch**).
3. Tap the green **In Stock** button next to an item. It turns red and says **Sold Out**. Tap again to put it back in stock.
   - **Mark all In Stock** resets a whole station at the start of the day.
4. You can also:
   - Change an item's **name**, **price ($)**, or **calories (Cal)** right in the row.
   - Tap **Description, allergens, tags, delete** under an item to edit the description, allergen badges (for example `Contains Gluten, Contains Dairy`), tags (for example `Vegetarian`, `Gluten-Free`, `100% Halal Certified`), or delete the item.
   - Tap **Add item to …** to add a daily special, or **Add new section** for a new heading like "Daily Specials".
   - Open **Hours & Settings** to change **Cafeteria Operating Hours**, the **Deli Hult rate per lb**, the cafeteria name, or the passcode.
5. When you are done, tap **Publish Live to GitHub**.
6. You will see **"Published!"**. Students see the update after GitHub Pages refreshes, usually within 1–2 minutes. They may need to refresh the page.

**Backup option:** **Download `menu.json` (Backup)** saves the edited menu to your device. To publish it by hand: open the repository on GitHub → **Add file** → **Upload files** → drop in `menu.json` → **Commit changes**.

Other buttons:
- **Discard changes** undoes everything since the last publish.
- **Log out** locks the editor. If "Remember token" was off, the token is also forgotten.

---

## Part 4: Changing the Admin Passcode

1. Log in → **Hours & Settings** → **Change Admin Passcode**.
2. Type the new passcode twice (at least 6 characters) → **Set new passcode**.
3. Tap **Publish Live to GitHub**. The new passcode works for everyone after the site refreshes.

The passcode is stored in `menu.json` as a SHA-256 hash (`settings.admin_passcode_sha256`), never as plain text.

---

## How it works (for the curious)

- **Live status badge:** `app.js` compares the visitor's local time with `hours` in `menu.json` and rechecks every 30 seconds:
  - 8:00 AM – 2:30 PM → green **Open Now • Full Cafeteria Menu Available**
  - 2:30 PM – 4:00 PM → amber **Afternoon Hours • Espresso Bar & Baked Goods Only**
  - Before 8:00 AM or after 4:00 PM → red **Cafeteria Currently Closed • Viewing Menu**
- **Sold Out:** items with `"available": false` stay on the menu, greyed out (`opacity-50 grayscale`) with a red **SOLD OUT** badge. In the calculators they cannot be selected.
- **Calculators:** the Deli Hult and Broad Grill tabs add up calories (and estimated price on Broad Grill) for whatever the student checks. Sections with `"select": "single"` (Deli bread, Grill entree) allow one choice. Items without listed calories are marked with `*`.
- **Publishing:** the editor calls the GitHub REST API from the browser. It first reads the current `menu.json` to get its `sha`, then sends `PUT /repos/{owner}/{repo}/contents/menu.json` with the new file (base64-encoded). That creates a normal commit in the repository, and GitHub Pages redeploys the site.

### `menu.json` structure

```text
settings   cafeteria_name, admin_passcode_sha256, nutrition_advisory
hours      open, main_close, espresso_close ("HH:MM", 24-hour), main_label, afternoon_notice
stations[] id, name, tagline, icon (Lucide name), hours_group ("main" or "espresso"), note,
           builder (null, or { title, show_price }),
           Deli only: pricing_model "by_weight", price_per_lb (number or null), price_per_lb_display
  sections[] id, title, price_note, builder (null, or { select: "single"|"multi", group })
    items[]  id, name, price (number or null), calories (number or null),
             description, allergens[], tags[], available (true/false)
```

You can also edit `menu.json` directly on GitHub (open the file → pencil icon → **Commit changes**). Keep it valid JSON: commas between items, double quotes around text, `true`/`false`/`null` without quotes.

### Preview on your own computer

Opening `index.html` by double-clicking will not load the menu, because browsers block reading `menu.json` from a file. Start a tiny local web server in this folder instead:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

---

## Security notes

- **The passcode only unlocks the editor screen.** This is a public static site, so anyone technical could open the editor. What actually protects the menu is the **GitHub token**: without a valid token, nobody can publish.
- Use a **fine-grained** token limited to **only this repository** with **only Contents: Read and write**, and give it an **expiration date**.
- "Remember token on this device" stores the token in the browser's local storage. Only use it on a personal device. Browsers share local storage across all sites under `owengachuhi.github.io`, so do not turn it on if other untrusted projects are published under the same account.
- The page loads Tailwind CSS and Lucide icons from public CDNs (versions are pinned; Lucide uses Subresource Integrity).
- If a token is lost or a device is stolen: GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens** → open the token → **Delete**. Then create a new one.

---

## Troubleshooting

| Message or problem | Fix |
| --- | --- |
| **401** when publishing | The token is wrong or expired. Make a new one (Part 2, Step A). |
| **403** when publishing | The token needs **Contents: Read and write** on `1965-Menu`. If the repository belongs to an organization, an admin may need to approve the token. |
| **404** when publishing | Check **Repository** (`owner/repo`) and **Branch** in **Hours & Settings → GitHub Connection**, and that the token was given access to this repository. |
| **409** when publishing | Someone else published at the same moment. Press **Publish** again. |
| Students still see the old menu | Wait 1–2 minutes and refresh. Check the **Actions** tab for a finished **pages build and deployment** run. |
| "The menu could not be loaded" | `menu.json` has a typo. Restore it from the commit history or upload your downloaded backup. |
| Console warning about `cdn.tailwindcss.com` | Expected. Tailwind prints this for its CDN build. The site works normally. |

---

2,000 calories a day is used for general nutrition advice, but calorie needs vary. Additional nutritional and allergy information available upon request.
