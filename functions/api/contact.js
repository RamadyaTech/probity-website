/**
 * Contact form endpoint — Cloudflare Pages Function.
 * Route: POST /api/contact   (file path maps to the route automatically)
 *
 * Behaviour, in order:
 *   1. Honeypot + validation           (always on)
 *   2. Turnstile verification          (only if TURNSTILE_SECRET_KEY is set)
 *   3. Write the lead to D1            (only if the DB binding exists) — done FIRST so a
 *                                      lead is never lost even if email delivery fails
 *   4. Send a notification email       (first configured transport wins, see notify())
 *
 * Every step is optional except validation, so the form degrades gracefully:
 * with nothing configured it still returns a clear error instead of failing silently.
 * See DEPLOY.md for setup.
 */

const MAX = { name: 200, company: 200, email: 320, phone: 40, interest: 80, message: 5000 };

export async function onRequestPost(context) {
  const { request, env } = context;
  const json = (data, status) => Response.json(data, { status: status || 200 });

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: 'Could not read the submission.' }, 400);
  }

  // 1a. Honeypot — bots fill hidden fields. Return 200 so they don't retry.
  if (String(form.get('company_website') || '').trim()) return json({ ok: true });

  const val = (k) => String(form.get(k) || '').trim();
  const name = val('name');
  const company = val('company');
  const email = val('email');
  const phone = val('phone');
  const interest = val('interest');
  const message = val('message');

  // 1b. Validation — never trust the client
  if (!name || !company || !email || !message) {
    return json({ ok: false, error: 'Please complete all required fields.' }, 400);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
    return json({ ok: false, error: 'Please enter a valid work email address.' }, 400);
  }
  for (const [field, limit] of Object.entries(MAX)) {
    if (({ name, company, email, phone, interest, message })[field].length > limit) {
      return json({ ok: false, error: 'That submission is too long.' }, 400);
    }
  }

  // 2. Turnstile (skipped entirely until you configure the secret)
  if (env.TURNSTILE_SECRET_KEY) {
    const token = form.get('cf-turnstile-response');
    if (!token) return json({ ok: false, error: 'Verification failed. Please try again.' }, 403);
    const outcome = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: request.headers.get('CF-Connecting-IP') || undefined,
      }),
    })
      .then((r) => r.json())
      .catch(() => ({ success: false }));
    if (!outcome.success) {
      return json({ ok: false, error: 'Verification failed. Please try again.' }, 403);
    }
  }

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ua = request.headers.get('User-Agent') || '';
  const now = new Date().toISOString();

  // 3. Persist first — email is the only lossy link in the chain
  let leadId = null;
  if (env.DB) {
    try {
      const { meta } = await env.DB.prepare(
        `INSERT INTO leads (created_at, name, company, email, phone, interest, message, ip, ua)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(now, name, company, email, phone, interest, message, ip, ua)
        .run();
      leadId = meta && meta.last_row_id;
    } catch (err) {
      console.error('D1 insert failed:', err && err.message);
    }
  }

  // 4. Notify
  const subject = `New enquiry — ${interest || 'General'} (${company})`;
  const text =
    `Name:      ${name}\n` +
    `Company:   ${company}\n` +
    `Email:     ${email}\n` +
    `Phone:     ${phone || '—'}\n` +
    `Interest:  ${interest || '—'}\n\n` +
    `${message}\n\n` +
    `---\nReceived ${now}\nIP ${ip}\n${ua}`;

  let emailed = false;
  try {
    emailed = await notify(env, { subject, text, replyTo: email });
  } catch (err) {
    console.error('Notification failed:', err && err.message);
  }

  if (emailed && leadId && env.DB) {
    try {
      await env.DB.prepare('UPDATE leads SET emailed = 1 WHERE id = ?').bind(leadId).run();
    } catch { /* non-fatal */ }
  }

  // Only a hard failure if the lead was neither stored nor sent
  if (!emailed && leadId === null) {
    return json(
      { ok: false, error: 'We could not deliver your message. Please email us directly.' },
      500
    );
  }
  return json({ ok: true });
}

/**
 * First configured transport wins.
 *   A. MAILER          — service binding to a Worker holding Cloudflare's send_email binding.
 *                        Adds NO new data processor. Recommended.
 *   B/C/D. Third-party REST APIs. Each becomes a sub-processor you must disclose.
 */
async function notify(env, msg) {
  const to = env.SALES_EMAIL || 'sales@probitygrc.com';
  const from = env.FROM_EMAIL || 'website@probitygrc.com';

  // A. Cloudflare Email Service, via a service-bound Worker
  if (env.MAILER && typeof env.MAILER.fetch === 'function') {
    const res = await env.MAILER.fetch('https://mailer.internal/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, from, replyTo: msg.replyTo, subject: msg.subject, text: msg.text }),
    });
    if (!res.ok) console.error('MAILER responded', res.status, await res.text());
    return res.ok;
  }

  // B. Brevo (EU-based)
  if (env.BREVO_API_KEY) {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: from, name: 'Probity Website' },
        to: [{ email: to }],
        replyTo: { email: msg.replyTo },
        subject: msg.subject,
        textContent: msg.text,
      }),
    });
    if (!res.ok) console.error('Brevo responded', res.status, await res.text());
    return res.ok;
  }

  // C. Zoho ZeptoMail (India-based; use api.zeptomail.com for the global DC)
  if (env.ZEPTOMAIL_TOKEN) {
    const res = await fetch(env.ZEPTOMAIL_URL || 'https://api.zeptomail.in/v1.1/email', {
      method: 'POST',
      headers: { Authorization: env.ZEPTOMAIL_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: { address: from, name: 'Probity Website' },
        to: [{ email_address: { address: to } }],
        reply_to: [{ address: msg.replyTo }],
        subject: msg.subject,
        textbody: msg.text,
      }),
    });
    if (!res.ok) console.error('ZeptoMail responded', res.status, await res.text());
    return res.ok;
  }

  // D. Resend
  if (env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], reply_to: msg.replyTo, subject: msg.subject, text: msg.text }),
    });
    if (!res.ok) console.error('Resend responded', res.status, await res.text());
    return res.ok;
  }

  console.warn('No email transport configured — lead stored in D1 only.');
  return false;
}
