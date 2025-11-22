// /api/klaviyo-contact.js
export default async function handler(req, res) {
  // --- CORS (tighten origin in production if desired) ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method Not Allowed' });

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

    // extract email (Dawn form uses name="contact[email]")
    const email = payload['contact[email]'] || payload.email || payload.contact_email || '';
    if (!email) return res.status(400).json({ ok: false, message: 'Missing email' });

    const KLAVIYO_API_KEY = (process.env.KLAVIYO_API_KEY || '').trim();
    const KLAVIYO_PUBLIC_KEY = (process.env.KLAVIYO_PUBLIC_KEY || '').trim(); // for track
    const KLAVIYO_LIST_ID = (payload.klaviyo_list || process.env.KLAVIYO_LIST_ID || '').trim();
    const REVISION = process.env.KLAVIYO_API_REVISION || '2025-10-15';
    const ALLOWED = (process.env.ALLOWED_KLAVIYO_LISTS || '').split(',').map(s => s.trim()).filter(Boolean);

    if (!KLAVIYO_API_KEY) return res.status(500).json({ ok: false, message: 'Missing KLAVIYO_API_KEY in env' });
    if (!KLAVIYO_LIST_ID) return res.status(400).json({ ok: false, message: 'Missing klaviyo_list' });
    if (ALLOWED.length && !ALLOWED.includes(KLAVIYO_LIST_ID)) {
      return res.status(400).json({ ok: false, message: 'klaviyo_list not allowed' });
    }

    // --- 1) Create / Update profile (only allowed profile attributes) ---
    const profileBody = {
      data: {
        type: 'profile',
        attributes: {
          email: email,
          first_name: payload.first_name || payload.name || undefined,
          phone_number: payload.phone || undefined
        }
      }
    };

    const createResp = await fetch('https://a.klaviyo.com/api/profiles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.api+json',
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
        'Revision': REVISION
      },
      body: JSON.stringify(profileBody)
    });

    const createText = await createResp.text();
    let createJson = null;
    try { createJson = JSON.parse(createText); } catch (e) { createJson = createText; }

    if (!createResp.ok) {
      console.error('PROFILE CREATE ERROR:', createResp.status, createText);
      return res.status(502).json({ ok: false, step: 'profile_create', status: createResp.status, body: createJson });
    }

    const profileId = createJson?.data?.id;
    if (!profileId) {
      console.error('No profile id returned', createText);
      return res.status(502).json({ ok: false, message: 'No profile id returned', body: createJson });
    }

    // --- 2) Link profile to list ---
    const listEndpoint = `https://a.klaviyo.com/api/lists/${encodeURIComponent(KLAVIYO_LIST_ID)}/relationships/profiles`;
    const linkBody = { data: [{ type: 'profile', id: profileId }] };

    const linkResp = await fetch(listEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.api+json',
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
        'Revision': REVISION
      },
      body: JSON.stringify(linkBody)
    });

    const linkText = await linkResp.text();
    let linkJson = null;
    try { linkJson = JSON.parse(linkText); } catch (e) { linkJson = linkText; }

    if (!linkResp.ok && linkResp.status !== 204) {
      console.error('LIST LINK ERROR:', linkResp.status, linkText);
      return res.status(502).json({ ok: false, step: 'list_link', status: linkResp.status, body: linkJson });
    }

    // --- 3) Track via Klaviyo /api/track (simple, auto-creates metric) ---
    let klaviyoTrackStatus = null;
    let klaviyoTrackResponse = null;

    try {
      if (KLAVIYO_PUBLIC_KEY) {
        const trackPayload = {
          token: KLAVIYO_PUBLIC_KEY,
          event: 'Contact Form Submitted',
          customer_properties: { '$email': email },
          properties: {
            page_url: payload.page_url || '',
            referrer: payload.referrer || '',
            product_handle: payload.product_handle || '',
            product_title: payload.product_title || '',
            product_id: payload.product_id || '',
            utm_source: payload.utm_source || '',
            utm_medium: payload.utm_medium || '',
            utm_campaign: payload.utm_campaign || ''
          }
        };

        const dataString = Buffer.from(JSON.stringify(trackPayload)).toString('base64');
        const trackResp = await fetch('https://a.klaviyo.com/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(dataString)}`
        });

        klaviyoTrackStatus = trackResp.status;
        klaviyoTrackResponse = await trackResp.text();
        if (!trackResp.ok) {
          console.warn('Klaviyo track failed', trackResp.status, klaviyoTrackResponse);
        } else {
          console.log('Klaviyo track OK', klaviyoTrackResponse);
        }
      } else {
        console.warn('No KLAVIYO_PUBLIC_KEY set; skipping track');
      }
    } catch (err) {
      console.warn('Track error', String(err));
    }

    // --- Success response to caller ---
    return res.status(200).json({
      ok: true,
      email: email,
      profile_id: profileId,
      list_id: KLAVIYO_LIST_ID,
      klaviyo_profile_create_status: createResp.status,
      klaviyo_list_link_status: linkResp.status,
      klaviyo_track_status: klaviyoTrackStatus,
      klaviyo_track_response: klaviyoTrackResponse
    });

  } catch (err) {
    console.error('SERVER ERROR:', err);
    return res.status(500).json({ ok: false, message: 'Server error', error: String(err) });
  }
}
