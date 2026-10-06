# vehicle-service-contract.com — Pure Protection quote page

Collects **name, email, phone (optional), VIN, model, mileage** and saves each lead to a Google Sheet in your Drive.

## How it works (and why it's secure)

```
Customer's browser ──► Netlify Function ──► Google Apps Script ──► Google Sheet (your Drive)
   (form + reCAPTCHA)    (checks everything)   (checks secret, saves)
```

- **HTTPS everywhere** (Netlify gives free SSL) plus strict security headers.
- **No secrets in the web page.** The reCAPTCHA secret and the Apps Script link live only in Netlify settings.
- **Bot protection:** reCAPTCHA v3 (verified on the server), a hidden honeypot field, and rate limits in two places.
- **Every field re-checked on the server**, including the VIN check digit.
- **Apps Script only accepts requests carrying your shared secret.**
- **Sheet stays private** — only you (and people you share it with) can open it.
- Blocks "formula injection" so nothing typed into the form can run as a spreadsheet formula.

---

## Setup — about 30 minutes, in this order

### 1. Google Sheet + Apps Script
1. In Google Drive, create a new Google Sheet named **Pure Protection Leads**.
2. **Extensions → Apps Script.** Delete what's there, paste in all of `google-apps-script/Code.gs`, click **Save**.
3. In the function dropdown at the top, pick **setup** and click **Run**. Approve the permissions (Advanced → Go to project → Allow).
4. Click **Execution log** — copy the long `SHARED_SECRET` it printed. Keep it handy.
5. *(Optional)* **Project Settings (gear) → Script Properties → Add**: `NOTIFY_EMAIL` = the address that should get an alert for every new lead.
6. **Deploy → New deployment → ⚙ Select type → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy** and copy the **Web app URL** (ends in `/exec`).

> If you ever edit Code.gs later: **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy.** Saving alone does not update the live script — this was the old sticking point.

### 2. reCAPTCHA keys
1. Go to https://www.google.com/recaptcha/admin/create
2. Type: **Score based (v3)**. Domains: `vehicle-service-contract.com` (and your `*.netlify.app` address while testing).
3. Copy the **Site key** and **Secret key**.
4. Paste the **Site key** in two places: the `<script src=...render=YOUR_RECAPTCHA_SITE_KEY>` line in `public/index.html`, and the top line of `public/app.js`. (The site key is meant to be public.)

### 3. GitHub
1. Create a new **private** repository (e.g. `vehicle-service-contract`).
2. Upload everything in this folder **keeping the folder structure** (`public/`, `netlify/functions/`, `netlify.toml` at the top level). On github.com: **Add file → Upload files** and drag the folder contents in.

### 4. Netlify
1. **Add new site → Import an existing project → GitHub** → pick the repo. Leave build settings as they are (`netlify.toml` handles it) and deploy.
2. **Site configuration → Environment variables → Add** these four:

| Key | Value |
|---|---|
| `RECAPTCHA_SECRET_KEY` | reCAPTCHA **secret** key |
| `APPS_SCRIPT_URL` | the Apps Script `/exec` URL |
| `SHARED_SECRET` | the secret from step 1.4 |
| `ALLOWED_ORIGINS` | `https://vehicle-service-contract.com,https://www.vehicle-service-contract.com,https://YOUR-SITE.netlify.app` |

3. **Deploys → Trigger deploy → Deploy site** so the function picks up the variables.
4. **Domain management → Add domain** → `vehicle-service-contract.com` and follow Netlify's DNS instructions. SSL turns on automatically.

### 5. Test
1. Open the site, submit with your own info and a real VIN.
2. A new row should appear in the **Leads** tab within a few seconds (and an email, if you set `NOTIFY_EMAIL`).
3. Once the real domain works, remove the `.netlify.app` address from `ALLOWED_ORIGINS` and the reCAPTCHA domain list.

## Troubleshooting
| Message on the form | Fix |
|---|---|
| "Form is not configured yet" | A Netlify environment variable is missing — add it, then redeploy. |
| "Request not allowed" | The address in the browser isn't listed in `ALLOWED_ORIGINS` (check https and www). |
| "We couldn't verify your submission" | Site key / secret key mismatch, or the domain isn't added in reCAPTCHA admin. |
| "We couldn't save your request" | Apps Script URL wrong, `SHARED_SECRET` doesn't match, or script not redeployed as a new version. Check **Netlify → Logs → Functions**. |

## Before going live
- Fill in the `[BRACKETED]` items in `public/privacy.html` and have Penske compliance review it.
- The Sheet holds customer personal info — share it only with people who need it.
