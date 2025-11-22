export default async function handler(req, res) {
  // ----- CORS -----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });

  try {
    const payload =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    const email =
      payload["contact[email]"] ||
      payload.email ||
      payload.contact_email ||
      "";

    if (!email) {
      return res
        .status(400)
        .json({ ok: false, message: "Missing email field" });
    }

    const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY;
    const KLAVIYO_LIST_ID =
      payload.klaviyo_list || process.env.KLAVIYO_LIST_ID;
    const REVISION = process.env.KLAVIYO_API_REVISION || "2025-10-15";

    if (!KLAVIYO_API_KEY) {
      return res
        .status(500)
        .json({ ok: false, message: "Missing KLAVIYO_API_KEY" });
    }

    if (!KLAVIYO_LIST_ID) {
      return res
        .status(400)
        .json({ ok: false, message: "Missing list id" });
    }

    // ----- 1) CREATE / UPDATE PROFILE -----
    const profileBody = {
      data: {
        type: "profile",
        attributes: {
          email: email,
          first_name: payload.first_name || payload.name || undefined,
          phone_number: payload.phone || undefined,
          page_url: payload.page_url || undefined,
          referrer: payload.referrer || undefined,
          product_handle: payload.product_handle || undefined,
          product_title: payload.product_title || undefined,
          product_id: payload.product_id || undefined
        }
      }
    };

    const createProfile = await fetch("https://a.klaviyo.com/api/profiles", {
      method: "POST",
      headers: {
        "Content-Type": "application/vnd.api+json",
        Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
        Revision: REVISION
      },
      body: JSON.stringify(profileBody)
    });

    const profileText = await createProfile.text();
    let profileJson = null;
    try {
      profileJson = JSON.parse(profileText);
    } catch {
      profileJson = profileText;
    }

    if (!createProfile.ok) {
      console.error("PROFILE CREATE ERROR:", createProfile.status, profileText);
      return res.status(502).json({
        ok: false,
        step: "profile_create",
        status: createProfile.status,
        body: profileJson
      });
    }

    const profileId =
      profileJson?.data?.id ||
      profileJson?.included?.[0]?.id;

    if (!profileId) {
      return res.status(502).json({
        ok: false,
        message: "No profile ID returned",
        body: profileJson
      });
    }

    // ----- 2) ADD PROFILE TO LIST -----
    const listBody = {
      data: [{ type: "profile", id: profileId }]
    };

    const addToList = await fetch(
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

    const addText = await addToList.text();
    let addJson = null;
    try {
      addJson = JSON.parse(addText);
    } catch {
      addJson = addText;
    }

    // Klaviyo returns 204 No Content for successful relationship link
    if (!addToList.ok && addToList.status !== 204) {
      console.error("LIST LINK ERROR:", addToList.status, addText);
      return res.status(502).json({
        ok: false,
        step: "list_link",
        status: addToList.status,
        body: addJson
      });
    }

    return res.status(200).json({
      ok: true,
      email: email,
      profile_id: profileId,
      list_id: KLAVIYO_LIST_ID,
      klaviyo_profile_create_status: createProfile.status,
      klaviyo_list_link_status: addToList.status
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
