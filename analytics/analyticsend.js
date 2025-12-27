import express from "express";
import { supabase_connect } from "../supabase/set-up.js";
const router = express.Router();
async function getAuthUser(req) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.replace("Bearer ", "")
      : null;

    if (!token) return null;

    const { data, error } = await supabase_connect.auth.getUser(token);
    if (error) return null;

    return data.user;
  } catch {
    return null;
  }
}
function isSimilarDevice(a, b) {
  let score = 0;

  if (a.hw === b.hw) score += 50;
  if (a.os === b.os) score += 20;
  if (a.tz === b.tz) score += 10;
  if (a.screen === b.screen) score += 10;
  if (a.ip_segment === b.ipSeg) score += 30;

  return score >= 50;
}

/* TRACK VIEW ROUTE (UNCHANGED) */
router.post("/track", async (req, res) => {
  const {
    submissionUniqueId,
    browserID,
    hw,
    ipSeg,
    os,
    tz,
    screen,
  } = req.body;

console.log("[TRACK] Incoming payload:", req.body);

  const { data: submission } = await supabase_connect
    .from("design_submissions")
    .select("id , user_id")
    .eq("unique_id", submissionUniqueId)
    .single();

  if (!submission) {
    return res.status(404).json({ error: "Submission not found" });
  }
     const authUser = await getAuthUser(req);
const isOwner = !!(authUser && authUser.id === submission.user_id);
if (isOwner) {
  return res.json({ skipped: true, reason: "owner_view" });
}

  const submissionId = submission.id;
  console.log("[TRACK] Submission resolved:", {
  submissionId: submission.id,
  ownerId: submission.user_id,
});


  const today = new Date().toISOString().slice(0, 10);
console.log("[DAILY] Updating daily views", {
  submissionId,
  today,
});

// 1️⃣ Try to fetch today's row
const { data: existing } = await supabase_connect
  .from("submission_daily_views")
  .select("views")
  .eq("submission_id", submissionId)
  .eq("view_date", today)
  .single();

if (existing) {
  // 2️⃣ Row exists → increment
  await supabase_connect
    .from("submission_daily_views")
    .update({
      views: existing.views + 1,
    })
    .eq("submission_id", submissionId)
    .eq("view_date", today);

  console.log("[DAILY] Incremented views to", existing.views + 1);
} else {
  // 3️⃣ First view of the day → insert
  await supabase_connect
    .from("submission_daily_views")
    .insert({
      submission_id: submissionId,
      view_date: today,
      views: 1,
    });

  console.log("[DAILY] Inserted first daily view");
}





  const { data: stat } = await supabase_connect
    .from("submission_view_stats")
    .select("*")
    .eq("submission_id", submissionId)
    .single();

  if (!stat) {
    await supabase_connect
      .from("submission_view_stats")
      .insert({
        submission_id: submissionId,
        total_views: 0,
        unique_views: 0,

      });
  }

  const { data: statsNow } = await supabase_connect
    .from("submission_view_stats")
    .select("total_views, unique_views")
    .eq("submission_id", submissionId)
    .single();
  await supabase_connect
    .from("submission_view_stats")
    .update({
      total_views: (statsNow?.total_views || 0) + 1,
    })
    .eq("submission_id", submissionId);
//  GLOBAL FIRST VIEW (NOT DEVICE-DEPENDENT)
const now = new Date().toISOString();

// set first_viewed_at ONLY ONCE
await supabase_connect
  .from("submission_view_stats")
  .update({
    first_viewed_at: now,
    last_viewed_at: now,
  })
  .is("first_viewed_at", null)
  .eq("submission_id", submissionId);

// always update last_viewed_at
await supabase_connect
  .from("submission_view_stats")
  .update({
    last_viewed_at: now,
  })
  .eq("submission_id", submissionId);

  const { data: rows } = await supabase_connect
    .from("submission_device_views")
    .select("*")
    .eq("submission_id", submissionId);

  const sameBrowser = rows.find(
    (r) => r.browser_id === browserID
  );

  if (sameBrowser) {
    return res.json({ unique: false });
  }

  /* Try to link browser to existing device */
  let matchedDeviceGroup = null;

  for (const row of rows) {
    if (
      isSimilarDevice(row, {
        hw,
        ipSeg,
        os,
        tz,
        screen,
      })
    ) {
      matchedDeviceGroup = row.device_group;
      break;
    }
  }

  /*  New physical device */
  let isUnique = false;

  if (!matchedDeviceGroup) {
    isUnique = true;
    matchedDeviceGroup = crypto.randomUUID();

    await supabase_connect
      .from("submission_view_stats")
      .update({
        unique_views: (statsNow?.unique_views || 0) + 1,
      })
      .eq("submission_id", submissionId);
  }

  /* Store browser visit */
  await supabase_connect
    .from("submission_device_views")
    .insert({
      submission_id: submissionId,
      browser_id: browserID,
      hw,
      ip_segment: ipSeg,
      os,
      tz,
      screen,
      device_group: matchedDeviceGroup,
    });

  return res.json({ unique: isUnique });
});
router.post("/time", async (req, res) => {
  try {
    console.log("[TIME] raw body:", req.body);

    let body = req.body;

    //handle sendBeacon/text or fetch/json
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        console.log("[TIME]  invalid JSON");
        return res.json({ ok: false });
      }
    }

    const { submissionUniqueId, timeSpent } = body;

    console.log("[TIME] parsed:", { submissionUniqueId, timeSpent });
     
    //  CORRECT validation (0 is allowed!)
    if (
      typeof submissionUniqueId !== "string" ||
      typeof timeSpent !== "number"
    ) {
      console.log("[TIME]  invalid payload", body);
      return res.json({ ok: false });
    }

    // only block impossible values
    if (timeSpent < 0 || timeSpent > 6 * 60 * 60) {
      console.log("[TIME] ⏭ ignored unrealistic timeSpent:", timeSpent);
      return res.json({ ok: true, ignored: true });
    }

    //  resolve submission
    const { data: submission } = await supabase_connect
      .from("design_submissions")
      .select("id , user_id")
      .eq("unique_id", submissionUniqueId)
      .single();

    if (!submission) {
      console.log("[TIME]  submission not found:", submissionUniqueId);
      return res.status(404).json({ ok: false });
    }
  
const authUser = await getAuthUser(req);
const isOwner = !!(authUser && authUser.id === submission.user_id);


if (isOwner) {
  return res.json({ skipped: true, reason: "owner_view" });
}

    const submissionId = submission.id;
    const now = new Date().toISOString();

    //  fetch stats
    const { data: stat } = await supabase_connect
      .from("submission_view_stats")
      .select("*")
      .eq("submission_id", submissionId)
      .single();

    //  first time entry
    if (!stat) {
      await supabase_connect
        .from("submission_view_stats")
        .insert({
          submission_id: submissionId,
          total_time_spent: timeSpent,
          sessions_count: 1,
          avg_time_spent: timeSpent,
          first_viewed_at: now,
          last_viewed_at: now,
        });

      console.log("[TIME]  stats created");
      return res.json({ ok: true, created: true });
    }

    //update existing
    const total = (stat.total_time_spent || 0) + timeSpent;
    const sessions = (stat.sessions_count || 0) + 1;

    await supabase_connect
      .from("submission_view_stats")
      .update({
        total_time_spent: total,
        sessions_count: sessions,
        avg_time_spent: Math.round(total / sessions),
        last_viewed_at: now,
        updated_at: now,
      })
      .eq("submission_id", submissionId);

    console.log("[TIME] stats updated");

    res.json({ ok: true });
  } catch (err) {
    console.error("[ANALYTICS TIME ERROR]", err);
    res.status(500).json({ ok: false });
  }
});

export default router;