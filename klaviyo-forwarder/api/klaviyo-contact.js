// /api/klaviyo-contact.js

export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });

  try {
    // Parse payload
    const payload =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    console.log("DEBUG_PAYLOAD:", payload);

    // Extract email (Shopify uses contact[email])
    const email =
      payload["contact[email]"] ||
      payload.email ||
      payload.contact_email ||
      "";

    if (!email) {
      return res.status(400).json({ ok: false, message: "Missing email" });
    }

    // Extract form fields
    const contactName =
      payload.name ||
      payload.first_name ||
      payload["contact[Name]"] ||
      null;

    const contactPhone =
      payload.phone ||
      payload["contact[Phone number]"] ||
      payload["contact[Phone]"] ||
      null;

    const contactMessage =
      payload.message ||
      payload["contact[Message]"] ||
      payload["contact[Body]"] ||
      payload["contact[Comment]"] ||
      null;

    // Context fields
    const pageUrl = payload.page_url || "";
    const referrer = payload.referrer || "";
    const productHandle = payload.product_handle || "";

    // --- ENV VARS ---
    const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY || "";
    const KLAVIYO_LIST_ID =
      payload.klaviyo_list || process.env.KLAVIYO_LIST_ID || "";

    const REVISION = process.env.KLAVIYO_API_REVISION || "2025-10-15";

    if (!KLAVIYO_API_KEY)
      return res
        .status(500)
        .json({ ok: false, message: "Missing KLAVIYO_API_KEY" });

    if (!KLAVIYO_LIST_ID)
      return res
        .status(500)
        .json({ ok: false, message: "Missing KLAVIYO_LIST_ID" });

    //
    // -------------------------------------------------------
    //   STEP 1 — CREATE PROFILE (POST)
    // -------------------------------------------------------
    //

    const createBody = {
      data: {
        type: "profile",
        attributes: {
          email: email
        }
      }
    };

    const createResp = await fetch("https://a.klaviyo.com/api/profiles", {
      method: "POST",
      headers: {
        "Content-Type": "application/vnd.api+json",
        Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
        Revision: REVISION
      },
      body: JSON.stringify(createBody)
    });

    const createText = await createResp.text();
    let createJson = {};
    try {
      createJson = JSON.parse(createText);
    } catch {}

    if (!createResp.ok && createResp.status !== 409) {
      console.error("PROFILE CREATE ERROR:", createResp.status, createText);
      return res.status(502).json({
        ok: false,
        step: "profile_create",
        status: createResp.status,
        body: createJson
      });
    }

    //
    // Extract profile ID (new or existing)
    //
    let profileId =
      createJson?.data?.id ||
      createJson?.errors?.[0]?.meta?.duplicate_profile_id ||
      null;

    if (!profileId) {
      console.error("No profile ID returned");
      return res.status(502).json({
        ok: false,
        message: "No profile ID returned",
        body: createJson
      });
    }

    //
    // -------------------------------------------------------
    //   STEP 2 — UPDATE CUSTOM PROPERTIES (PATCH)
    // -------------------------------------------------------
    //

    const updateBody = {
      data: {
        type: "profile",
        id: profileId,
        attributes: {
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

    const updateResp = await fetch(
      `https://a.klaviyo.com/api/profiles/${profileId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/vnd.api+json",
          Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
          Revision: REVISION
        },
        body: JSON.stringify(updateBody)
      }
    );

    const updateText = await updateResp.text();
    let updateJson = {};
    try {
      updateJson = JSON.parse(updateText);
    } catch {}

    if (!updateResp.ok) {
      console.warn("PROFILE UPDATE WARNING:", updateResp.status, updateText);
    }

    //
    // -------------------------------------------------------
    //   STEP 3 — ADD PROFILE TO LIST
    // -------------------------------------------------------
    //

    const listBody = {
      data: [{ type: "profile", id: profileId }]
    };

    const listResp = await fetch(
      `https://a.klaviyo.com/api/lists/${KLAVIYO_LIST_ID}/relationships/profiles`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/vnd.api+json",
          Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
          Revision: REVISION
        },
        body: JSON.stringify(listBody)
      }
    );

    const listText = await listResp.text();
    let listJson = {};
    try {
      listJson = JSON.parse(listText);
    } catch {}

    if (!listResp.ok && listResp.status !== 204) {
      console.warn("LIST LINK WARNING:", listResp.status, listText);
    }

    //
    // -------------------------------------------------------
    //   SUCCESS
    // -------------------------------------------------------
    //

    return res.status(200).json({
      ok: true,
      email,
      profile_id: profileId,
      list_id: KLAVIYO_LIST_ID,
      klaviyo_profile_create_status: createResp.status,
      klaviyo_profile_update_status: updateResp.status,
      klaviyo_list_link_status: listResp.status
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
