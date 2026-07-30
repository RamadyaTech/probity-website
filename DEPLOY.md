# Deploying the Probity website on Cloudflare

The site is static HTML/CSS/JS. The only moving part is the contact form, which posts to a
Cloudflare Pages Function at `/api/contact`.

Everything below is optional and layered — the form gets better as you switch pieces on.
With nothing configured the form still validates and, if it cannot reach the endpoint,
shows the visitor a copyable message and a link to email sales directly. It never fails silently.

---

## 1. Deploy the site

Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**, pick the repo.

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | *(leave empty)* |
| Build output directory | `/` |

The `functions/` directory is picked up automatically and `functions/api/contact.js`
becomes `POST /api/contact`.

> **Important:** Functions only work on Git-connected or Wrangler-deployed projects.
> Direct drag-and-drop uploads do **not** run Functions.

Pages Functions are included in the Workers **free** plan (100,000 requests/day).

---

## 2. Store leads in D1 — do this first

This is the safety net. Email is the only lossy step; the database write happens before it,
so a lead is never lost even if mail delivery breaks.

```bash
npx wrangler d1 create probity-leads
npx wrangler d1 execute probity-leads --remote --file=./schema.sql
```

Then: **Pages project → Settings → Bindings → Add → D1 database**
- Variable name: `DB`
- Database: `probity-leads`

**Redeploy after adding any binding.** Read your leads any time with:

```bash
npx wrangler d1 execute probity-leads --remote \
  --command="SELECT created_at,name,company,email,interest,emailed FROM leads ORDER BY id DESC LIMIT 20;"
```

Free tier: 100,000 writes/day, 5 GB. Far beyond a marketing site's needs.

---

## 3. Turn on email delivery

Pick **one**. The function tries them in this order and uses the first one configured.

### Option A — All-Cloudflare (recommended: adds no new data processor)

Cloudflare Pages Functions **cannot** hold the `send_email` binding — only Workers can. So a
tiny Worker owns it and the Pages Function calls it through a service binding. Everything
stays inside Cloudflare, which matters because Cloudflare is already your host, so your
sub-processor list does not grow.

1. Enable **Email Routing** on `probitygrc.com` (dashboard → Email Service → Email Routing →
   Onboard Domain). Cloudflare adds the MX/TXT records for you. Requires Cloudflare DNS.
2. Add your real inbox as a **Destination Address** and click the verification link.
   Sends to verified destination addresses on your own account are **free**.
3. Edit `cloudflare/mailer-worker/wrangler.jsonc` and set `destination_address` to that
   verified inbox, then deploy:
   ```bash
   cd cloudflare/mailer-worker
   npx wrangler deploy
   ```
4. **Pages project → Settings → Bindings → Add → Service binding**
   - Variable name: `MAILER`
   - Service: `probity-mailer`
5. Add plain variables: `SALES_EMAIL` = where enquiries go, `FROM_EMAIL` = an address on a
   domain you've onboarded (e.g. `website@probitygrc.com`).

> Cloudflare **Email Sending** is in public beta (since April 2026) and general
> arbitrary-recipient sending requires the Workers Paid plan ($5/mo). Sending only to your own
> *verified destination address* — which is all a contact form needs — is documented as free on
> all plans. Test it on Free first; if it's rejected, $5/mo removes the ambiguity. Either way
> the D1 write means a beta hiccup costs you a notification, never a lead.

### Option B — A third-party email API

Simpler, GA, no beta risk — but each of these **becomes a sub-processor you must disclose**
in your DPA and to customers on request. Set **one** secret under
**Settings → Variables and Secrets** (tick *Encrypt*):

| Variable | Provider | Notes |
|---|---|---|
| `BREVO_API_KEY` | Brevo | French company, EU data storage, 300 emails/day free. Easiest to justify in a GDPR-facing sub-processor list. |
| `ZEPTOMAIL_TOKEN` | Zoho ZeptoMail | Indian entity, INR/GST invoicing, India datacentre. Set `ZEPTOMAIL_URL` to `https://api.zeptomail.com/v1.1/email` for the global DC. |
| `RESEND_API_KEY` | Resend | Developer favourite, but a US entity built on AWS SES — arguably two processors. |

Also set `SALES_EMAIL` and `FROM_EMAIL`. The sending domain must be verified with the provider.

**Do not** follow any tutorial that posts to MailChannels — that free service was terminated
in June 2024 and a lot of stale blog posts still recommend it.

---

## 4. Spam protection with Turnstile (free)

1. Dashboard → **Turnstile → Add widget** for `probitygrc.com`. You get a **site key** (public)
   and a **secret key**.
2. In `pages/contact.html`, paste the site key into the marked line near the bottom:
   ```js
   var TURNSTILE_SITEKEY = "0x4AAAAAAA...";
   ```
   Leave it empty and the widget simply isn't rendered — nothing breaks.
3. Add the secret as an encrypted variable: `TURNSTILE_SECRET_KEY`.

The function only enforces verification when `TURNSTILE_SECRET_KEY` is present, so the two
halves can be switched on independently without breaking the form.

A hidden honeypot field is always active regardless — it catches most naive bots for free.

---

## 5. Receiving mail at sales@probitygrc.com

Email Routing (step 3.1) forwards `sales@probitygrc.com` to any verified inbox, free and
unlimited. **It is receive-only** — you cannot *reply* from that address. If sales@ needs to
be a real two-way mailbox, use Google Workspace or Zoho Mail (free for one domain, Indian
company) for that address instead.

---

## Environment variables reference

| Variable | Required | Purpose |
|---|---|---|
| `DB` | recommended | D1 binding — stores every lead |
| `MAILER` | Option A | Service binding to the mailer Worker |
| `BREVO_API_KEY` / `ZEPTOMAIL_TOKEN` / `RESEND_API_KEY` | Option B | Third-party transport (set one) |
| `SALES_EMAIL` | recommended | Recipient. Defaults to `sales@probitygrc.com` |
| `FROM_EMAIL` | recommended | Sender. Defaults to `website@probitygrc.com` |
| `TURNSTILE_SECRET_KEY` | optional | Enables server-side bot verification |
| `ZEPTOMAIL_URL` | optional | Override the ZeptoMail regional endpoint |

---

## Testing locally

```bash
npm install -D wrangler
npx wrangler d1 execute probity-leads --local --file=./schema.sql
npx wrangler pages dev .
curl -X POST http://localhost:8788/api/contact \
  -F "name=Test User" -F "company=Test Co" -F "email=test@example.com" -F "message=Hello"
# → {"ok":true}
```

Put local secrets in a `.dev.vars` file at the project root (already gitignored).

> **No root Wrangler config is included.** Set the D1 binding, the `MAILER`
> service binding and the environment variables in the Cloudflare dashboard
> (Pages project → Settings → Bindings / Variables and Secrets). That is the
> supported route and needs no config file in the repo. If you later want one
> for local development, `wrangler.jsonc` works and avoids `.toml` entirely.

---

## A note on the sub-processor list

The public sub-processors page has been removed, and the contact page states that security
and legal documentation is available to prospective customers on request. Keep that list
current internally: **Option A adds nothing to it** (Cloudflare already hosts the site);
**Option B adds one named processor** — Brevo, Zoho or Resend — which should be recorded
along with what data it handles and where it is stored.
