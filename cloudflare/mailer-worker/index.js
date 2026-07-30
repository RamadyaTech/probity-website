/**
 * Probity mailer Worker.
 *
 * Cloudflare Pages Functions cannot hold the `send_email` binding — only Workers can.
 * This tiny Worker owns that binding; the Pages Function reaches it through a
 * service binding named MAILER. That keeps email delivery entirely inside
 * Cloudflare, so no new data processor is introduced.
 *
 * Deploy:  cd cloudflare/mailer-worker && npx wrangler deploy
 * Then bind it: Pages project → Settings → Bindings → Service binding
 *               Variable name MAILER → service probity-mailer
 */
export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    const { to, from, subject, text, replyTo } = payload || {};
    if (!to || !from || !subject || !text) {
      return new Response('Missing required fields', { status: 400 });
    }

    try {
      const result = await env.EMAIL.send({
        to,
        from,
        subject,
        text,
        ...(replyTo ? { replyTo } : {}),
      });
      return Response.json({ ok: true, messageId: result && result.messageId });
    } catch (err) {
      // Most common causes: sender domain not onboarded to Email Service, or the
      // recipient is not a verified destination address on the account.
      return new Response(String((err && err.message) || err), { status: 502 });
    }
  },
};
