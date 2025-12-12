import express from "express";
import { supabase_connect } from "../supabase/set-up.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { user_id } = req.query;
   

    const { data, error } = await supabase_connect
      .from("notifications")
      .select("*")
      .eq("user_id", user_id)
      .order("last_viewed_at", { ascending: false });  // newest first

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      notifications: data
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
