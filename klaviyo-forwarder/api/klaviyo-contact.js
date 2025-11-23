// /api/klaviyo-contact.js

export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }

  try {
    const payload =
      typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    // --- EMAIL ---
    const email =
      payload["contact[email]"] ||
      payload.email ||
      payload.contact_email ||
      "";
    if (!email) {
      return res.status(400).json({ ok: false, message: "Missing email" });
    }

    // --- ENV CONFIG ---
    const KLAVIYO_API_KEY = (process.env.KLAVIYO_API_KEY || "").trim();
    const KLAVIYO_LIST_ID = (process.env.KLAVIYO_LIST_ID || "").trim();
    const REVISION = process.env.KLAVIYO_API_REVISION || "2025-10-15";

    if (!KLAVIYO_API_KEY) {
      return res
        .status(500)
        .json({ ok: false, message: "Missing KLAVIYO_API_KEY in env" });
    }
    if (!KLAVIYO_LIST_ID) {
      return res
        .status(500)
        .json({ ok: false, message: "Missing KLAVIYO_LIST_ID in env" });
    }

    // --- EXTRACT CONTACT FIELDS FROM FORM ---

    // Name: Dawn uses contact[Name] (translated), plus we support first_name/name from payload
    const contactName =
      payload["contact[Name]"] ||
      payload["contact[name]"] ||
      payload.first_name ||
      payload.name ||
      "";

  // Phone number — support your exact field name and a bunch of variants
  let contactPhone =
    payload["contact[Phone]"] ||
    payload["contact[phone]"] ||
    payload["contact[Phone number]"] ||   // 👈 your actual field
    payload["contact[Phone Number]"] ||
    payload["contact[phone number]"] ||
    payload.phone ||
    payload.telephone ||
    payload.tel ||
    payload.mobile ||
    "";

    // Extra safety: if still empty, grab the first field whose key includes "phone"
if (!contactPhone) {
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string" && /phone/i.test(key)) {
      contactPhone = value;
      break;
    }
  }
}

    // Message / comment textarea: support several common keys
    const contactMessage =
      payload["contact[Message]"] ||
      payload["contact[message]"] ||
      payload["contact[Comment]"] ||
      payload["contact[comment]"] ||
      payload.message ||
      payload.body ||
      "";

    // Page / product info from hidden fields
    const pageUrl = payload.page_url || "";
    const referrer = payload.referrer || "";
    const productHandle = payload.product_handle || "";
    const productTitle = payload.product_title || "";
    const productId = payload.product_id || "";

// --- BUILD PROFILE BODY WITH CUSTOM PROPERTIES ---
const profileBody = {
  data: {
    type: "profile",
    attributes: {
      email: email,   // <- REQUIRED for Klaviyo profile create/update
      properties: {
        contact_name: contactName || null,
        contact_email: email || null,
        contact_phone: contactPhone || null,
        contact_message: contactMessage || null,
        page_url: pageUrl || null,
        referrer_url: referrer || null,
        product_handle: productHandle || null
      }
    }
  }
};


    // --- 1) CREATE / UPDATE PROFILE ---
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
    let createJson;
    try {
      createJson = JSON.parse(createText);
    } catch {
      createJson = createText;
    }

    if (!createResp.ok) {
      console.error("PROFILE CREATE ERROR:", createResp.status, createText);
      return res.status(502).json({
        ok: false,
        step: "profile_create",
        status: createResp.status,
        body: createJson,
        debug_profile_payload: profileBody
      });
    }

    const profileId = createJson?.data?.id;
    if (!profileId) {
      console.error("No profile id returned", createText);
      return res.status(502).json({
        ok: false,
        message: "No profile id returned",
        body: createJson,
        debug_profile_payload: profileBody
      });
    }

    // --- 2) LINK PROFILE TO LIST ---
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
    let linkJson;
    try {
      linkJson = JSON.parse(linkText);
    } catch {
      linkJson = linkText;
    }

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

    // --- SUCCESS ---
    return res.status(200).json({
      ok: true,
      email,
      profile_id: profileId,
      list_id: KLAVIYO_LIST_ID,
      klaviyo_profile_create_status: createResp.status,
      klaviyo_list_link_status: linkResp.status,
      debug_profile_payload: profileBody
    });
  } catch (err) {
    console.error("SERVER ERROR:", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
      error: String(err)
    });
  }
}
