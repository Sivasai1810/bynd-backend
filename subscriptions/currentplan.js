import dotenv from 'dotenv'
dotenv.config()
import express from "express";
import { supabase_connect } from "../supabase/set-up.js";
import jwt from "jsonwebtoken";
const jwtpassword=process.env.JSONWEBPASSWORD
const router = express.Router();
const verifyplantoken=()=>{
  const token =req.cookies
  if(!token){
    
  }
}
router.get("/", verifyplantoken,async (req, res) => {
  try {
    const userId = req.query.user_id;

    if (!userId) {
      return res.status(400).json({ error: "user_id required" });
    }

    // 1. Fetch record
    let { data: sub, error } = await supabase_connect
      .from("user_subscriptions")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    // 2. If row not exist → create default record
    if (!sub) {
      const { data: created } = await supabase_connect
        .from("user_subscriptions")
        .insert({
          user_id: userId,
          plan_type: "free"
        })
        .select()
        .single();

      return res.json({ subscription: formatSubscription(created) });
    }

    // 3. Auto downgrade expired plans
    const now = new Date();
    let changed = false;
    const updates = {};

    if (sub.is_trial_active && sub.trial_expires_at && new Date(sub.trial_expires_at) < now) {
      updates.is_trial_active = false;
      updates.plan_type = "free";
      changed = true;
    }

    if (sub.is_subscription_active && sub.subscription_expires_at && new Date(sub.subscription_expires_at) < now) {
      updates.is_subscription_active = false;
      updates.plan_type = "free";
      changed = true;
    }

    if (changed) {
      const { data: updated } = await supabase_connect
        .from("user_subscriptions")
        .update(updates)
        .eq("user_id", userId)
        .select()
        .single();

      sub = updated;
    }

    return res.json({ subscription: formatSubscription(sub) });

  } catch (e) {
    // console.error("PLAN ERROR:", e);
    return res.status(500).json({ error: "Server error" });
  }
});


router.post("/start-trial", async (req, res) => {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: "user_id required" });
    }

    const { data: sub } = await supabase_connect
      .from("user_subscriptions")
      .select("*")
      .eq("user_id", user_id)
      .single();

    if (!sub) {
      return res.status(404).json({ error: "Subscription not found" });
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
        trial_expires_at: trialEnd.toISOString()
      })
      .eq("user_id", user_id)
      .select()
      .single();

    return res.json({
      message: "Trial started",
      subscription: formatSubscription(updated)
    });

  } catch (e) {
    
    return res.status(500).json({ error: "Server error" });
  }
});

function formatSubscription(sub) {
  const now = new Date();
  let days_remaining = 0;

  

  if (sub.is_trial_active && sub.trial_expires_at) {
    const trialEnd = new Date(sub.trial_expires_at);
    days_remaining = Math.max(
      0,
      Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24))
    );
    
  
  } else if (sub.is_subscription_active && sub.subscription_expires_at) {
    const subEnd = new Date(sub.subscription_expires_at);
    days_remaining = Math.max(
      0,
      Math.ceil((subEnd - now) / (1000 * 60 * 60 * 24))
    );
    
  } else {
    // console.log(' NO ACTIVE TRIAL OR SUBSCRIPTION');
  }

  const result = {
    plan_type: sub.plan_type,
    is_trial_active: sub.is_trial_active,
    trial_used: sub.trial_used,
    is_subscription_active: sub.is_subscription_active,
    can_start_trial: !sub.trial_used,
    trial_expires_at: sub.trial_expires_at,
    subscription_expires_at: sub.subscription_expires_at,
    trial_started_at: sub.trial_started_at,
    days_remaining: days_remaining
  };
  return result;
}

export default router;