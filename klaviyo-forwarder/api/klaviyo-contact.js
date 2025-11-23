// /api/klaviyo-contact.js
export default async function handler(req, res) {
  // --- CORS (tighten origin in production if desired) ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ ok: false, message: "Method Not Allowed" });
  }

  try {
    const payload =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    // --- Extract email (Dawn contact form uses name="contact[email]") ---
    const email =
      payload["contact[email]"] ||
      payload.email ||
      payload.contact_email ||
      "";
    if (!email) {
      return res
        .status(400)
        .json({ ok: false, message: "Missing email" });
    }

    const KLAVIYO_API_KEY = (process.env.KLAVIYO_API_KEY || "").trim();
    const KLAVIYO_LIST_ID = (
      payload.klaviyo_list ||
      process.env.KLAVIYO_LIST_ID ||
      ""
    ).trim();
    const REVISION = process.env.KLAVIYO_API_REVISION || "2025-10-15";
    const ALLOWED = (process.env.ALLOWED_KLAVIYO_LISTS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!KLAVIYO_API_KEY) {
      return res
        .status(500)
        .json({ ok: false, message: "Missing KLAVIYO_API_KEY in env" });
    }
    if (!KLAVIYO_LIST_ID) {
      return res
        .status(400)
        .json({ ok: false, message: "Missing klaviyo_list" });
    }
    if (ALLOWED.length && !ALLOWED.includes(KLAVIYO_LIST_ID)) {
      return res
        .status(400)
        .json({ ok: false, message: "klaviyo_list not allowed" });
    }

    // --- Extract contact fields from payload ---
    // Name: Dawn uses contact[Name] (capitalized) in English; your curl uses "first_name"
    const contactName =
      payload["contact[Name]"] ||
      payload["contact[name]"] ||
      payload.first_name ||
      payload.name ||
      "";

    // Phone: contact[Phone] or generic keys
    const contactPhone =
      payload["contact[Phone]"] ||
      payload["contact[phone]"] ||
      payload.phone ||
      "";

    // Comment / message textarea field
    const contactMessage =
      payload["contact[Message]"] ||
      payload["contact[message]"] ||
      payload["contact[Comment]"] ||
      payload["contact[comment]"] ||
      payload.message ||
      payload.body ||
      "";

    // Page / product info forwarded from Shopify form hidden fields
    const pageUrl = payload.page_url || "";
    const referrer = payload.referrer || "";
    const productHandle = payload.product_handle || "";
    const productTitle = payload.product_title || "";
    const productId = payload.product_id || "";

    // --- 1) Build profile payload with custom properties ---
    const profileBody = {
      data: {
        type: "profile",
        attributes: {
          email: email,
          first_name: contactName || undefined,
          phone_number: contactPhone || undefined,
          properties: {
            last_contact_page: pageUrl,
            last_contact_referrer: referrer,
            last_contact_product_handle: productHandle,
            last_contact_product_title: productTitle,
            last_contact_product_id: productId,
            last_contact_name: contactName,
            last_contact_phone: contactPhone,
            last_contact_message: contactMessage
          }
        }
      }
    };

    // --- 1) Create / Update profile in Klaviyo ---
    const createResp = await fetch("https://a.klaviyo.com/api/profiles", {
      method: "POST",
      headers: {
        "Content-Type": "application/vnd.api+json",
        Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
        Revision: REVISION
      },
      body: JSON.stringify(profileBody)
    });

    const createText = await createResp.text();
    let createJson = null;
    try {
      createJson = JSON.parse(createText);
    } catch (e) {
      createJson = createText;
    }

    if (!createResp.ok) {
      console.error("PROFILE CREATE ERROR:", createResp.status, createText);
      return res.status(502).json({
        ok: false,
        step: "profile_create",
        status: createResp.status,
        body: createJson
      });
    }

    const profileId = createJson?.data?.id;
    if (!profileId) {
      console.error("No profile id returned", createText);
      return res.status(502).json({
        ok: false,
        message: "No profile id returned",
        body: createJson
      });
    }

    // --- 2) Link profile to list ---
    const listEndpoint = `https://a.klaviyo.com/api/lists/${encodeURIComponent(
      KLAVIYO_LIST_ID
    )}/relationships/profiles`;
    const linkBody = { data: [{ type: "profile", id: profileId }] };

    const linkResp = await fetch(listEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/vnd.api+json",
        Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
        Revision: REVISION
      },
      body: JSON.stringify(linkBody)
    });

    const linkText = await linkResp.text();
    let linkJson = null;
    try {
      linkJson = JSON.parse(linkText);
    } catch (e) {
      linkJson = linkText;
    }

    // If link fails, we surface it, but still show profile info
    if (!linkResp.ok && linkResp.status !== 204) {
      console.error("LIST LINK ERROR:", linkResp.status, linkText);
      return res.status(502).json({
        ok: false,
        step: "list_link",
        status: linkResp.status,
        body: linkJson,
        debug_profile_payload: profileBody
      });
    }

    // --- Success response to caller ---
    return res.status(200).json({
      ok: true,
      email: email,
      profile_id: profileId,
      list_id: KLAVIYO_LIST_ID,
      klaviyo_profile_create_status: createResp.status,
      klaviyo_list_link_status: linkResp.status,
      debug_profile_payload: profileBody
    });
  } catch (err) {
    console.error("SERVER ERROR:", err);
    return res
      .status(500)
      .json({ ok: false, message: "Server error", error: String(err) });
  }
}
