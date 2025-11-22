// api/klaviyo-contact.js (Vercel serverless)
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: 'Method Not Allowed' });
  }

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

    // Extract email with common fallbacks (Shopify contact forms often use contact[email])
    const email =
      payload.email ||
      payload['contact[email]'] ||
      payload['contact[email]'] ||
      payload['email_address'] ||
      '';

    if (!email) {
      return res.status(400).json({ ok: false, message: 'Missing email' });
    }

    // Read optional properties
    const pageUrl = payload.page_url || '';
    const referrer = payload.referrer || '';
    const productHandle = payload.product_handle || '';
    const klaviyoListFromPayload = payload.klaviyo_list || '';
    const shopOrigin = payload._shop_origin || '';

    // ENV & defaults
    const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY;
    const DEFAULT_KLAVIYO_LIST_ID = process.env.KLAVIYO_LIST_ID || '';

    // Decide which list to use: prefer the one from the theme (metafield), else fallback to env var
    const klaviyoListToUse = klaviyoListFromPayload || DEFAULT_KLAVIYO_LIST_ID;

    if (!KLAVIYO_API_KEY) {
      console.error('Missing KLAVIYO_API_KEY');
      return res.status(500).json({ ok: false, message: 'Server not configured' });
    }
    if (!klaviyoListToUse) {
      console.warn('No Klaviyo list id provided; skipping subscribe (but track event could be used).');
      // We can continue and send a Track event instead, but for now return success
      return res.status(200).json({ ok: true, message: 'Received but no klaviyo_list set' });
    }

    // Basic safety check: only allow list ids that look reasonable (alphanumeric, hyphen, underscore)
    if (!/^[\w\-]+$/.test(klaviyoListToUse)) {
      console.warn('Invalid klaviyo_list format', klaviyoListToUse);
      return res.status(400).json({ ok: false, message: 'Invalid klaviyo_list' });
    }

    // Compose request to Klaviyo v2 list subscribe
    const listEndpoint = `https://a.klaviyo.com/api/v2/list/${encodeURIComponent(klaviyoListToUse)}/subscribe`;
    const body = {
      profiles: [
        {
          email: email,
          first_name: payload.first_name || payload.name || undefined,
          page_url: pageUrl || undefined,
          referrer: referrer || undefined,
          product_handle: productHandle || undefined,
          shop_origin: shopOrigin || undefined
        }
      ]
    };

    const r = await fetch(listEndpoint + `?api_key=${encodeURIComponent(KLAVIYO_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const text = await r.text();

    // Optionally log r.status and text for debugging (server logs only)
    console.log('Klaviyo response', r.status, text);

    return res.status(200).json({ ok: true, forwarded: true, klaviyoStatus: r.status, klaviyoResponse: text });
  } catch (err) {
    console.error('Server error', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
}
