



import express from "express";
import { supabase_connect } from "../supabase/set-up.js";

const router = express.Router();

//  In-memory cache (Level 1)

const subscriptionCache = new Map();
const CACHE_TTL = 60 * 1000; // 1 minute



router.get("/", async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: "user_id required" });
    }

    const cached = subscriptionCache.get(user_id);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json(cached.data);
    }

  
    let { data: sub } = await supabase_connect
      .from("user_subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .maybeSingle();

    let subscription;

    // Free user if no row
    if (!sub) {
      subscription = {
        plan_type: "free",
        is_trial_active: false,
        is_subscription_active: false,
        trial_used: false,
        days_remaining: 0,
        can_start_trial: true,
      };
    } else {
      subscription = deriveSubscription(sub);
    }

    const response = { subscription };

   
    subscriptionCache.set(user_id, {
      data: response,
      expiresAt: Date.now() + CACHE_TTL,
    });

    return res.json(response);

  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});


router.post("/start-trial", async (req, res) => {
  try {
   const { user_id } = req.body;
   console.log(req.body)
console.log("fdvdfvfdvdds")
console.log(user_id)
    if (!user_id) {
      return res.status(400).json({ error: "user_id required" });
    }

    let { data: sub } = await supabase_connect
      .from("user_subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .maybeSingle();

    // Create free row if missing
    if (!sub) {
      const { data: created } = await supabase_connect
        .from("user_subscriptions")
        .insert({
          user_id,
          plan_type: "free",
          is_trial_active: false,
          is_subscription_active: false,
          trial_used: false,
        })
        .select()
        .single();

      sub = created;
    }

    if (sub.trial_used) {
      return res.status(400).json({ error: "Trial already used" });
    }

    const now = new Date();
    const trialEnd = new Date();
    trialEnd.setDate(now.getDate() + 14);

    const { data: updated } = await supabase_connect
      .from("user_subscriptions")
      .update({
        plan_type: "pro_trial",
        is_trial_active: true,
        trial_used: true,
        trial_started_at: now.toISOString(),
        trial_expires_at: trialEnd.toISOString(),
      })
      .eq("user_id", user_id)
      .select()
      .single();

    // IMPORTANT: invalidate cache
    subscriptionCache.delete(user_id);

    return res.json({
      message: "Trial started",
      subscription: formatSubscription(updated),
    });

  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});


function deriveSubscription(sub) {
  const now = new Date();

  let plan_type = "free";
  let is_trial_active = false;
  let is_subscription_active = false;
  let days_remaining = 0;

  // Trial
  if (
    sub.plan_type === "pro_trial" &&
    sub.trial_expires_at &&
    new Date(sub.trial_expires_at) > now
  ) {
    plan_type = "pro_trial";
    is_trial_active = true;
    days_remaining = calcDays(sub.trial_expires_at);
  }

  // Paid subscription
  if (
    sub.plan_type === "pro_subscription" &&
    sub.subscription_expires_at &&
    new Date(sub.subscription_expires_at) > now
  ) {
    plan_type = "pro_subscription";
    is_subscription_active = true;
    days_remaining = calcDays(sub.subscription_expires_at);
  }

  return {
    plan_type,
    is_trial_active,
    is_subscription_active,
    trial_used: sub.trial_used,
    days_remaining,
    can_start_trial: !sub.trial_used,
  };
}

function formatSubscription(sub) {
  const now = new Date();
  let days_remaining = 0;

  if (sub.is_trial_active && sub.trial_expires_at) {
    days_remaining = calcDays(sub.trial_expires_at);
  }

  if (sub.is_subscription_active && sub.subscription_expires_at) {
    days_remaining = calcDays(sub.subscription_expires_at);
  }

  return {
    plan_type: sub.plan_type,
    is_trial_active: sub.is_trial_active,
    is_subscription_active: sub.is_subscription_active,
    trial_used: sub.trial_used,
    days_remaining,
    can_start_trial: !sub.trial_used,
  };
}

function calcDays(date) {
  return Math.max(
    0,
    Math.ceil((new Date(date) - new Date()) / (1000 * 60 * 60 * 24))
  );
}

export default router;

