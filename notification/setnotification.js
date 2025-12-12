import express from "express";
import { supabase_connect } from "../supabase/set-up.js";

const router = express.Router();
router.post("/:uniqueId", async (req, res) => {
  try {
    const { uniqueId } = req.params;
    // 1. Check if notification already exists
    const { data: existingNotification, error: findError } = await supabase_connect
      .from("notifications")
      .select("*")
      .eq("submission_id", uniqueId)
      .single();

    // 2. If exists → update last_viewed_at
    if (existingNotification) {
      const { data: updated, error: updateError } = await supabase_connect
        .from("notifications")
        .update({
          last_viewed_at: new Date()
        })
        .eq("submission_id", uniqueId)
        .select();

      if (updateError) {
        return res.status(500).json({ error: updateError.message });
      }

      return res.status(200).json({
        success: true,
        message: "Notification updated",
        notification: updated[0]
      });
    }

    // 3. If NOT exists → get submission details
    const { data: submission, error: fetchError } = await supabase_connect
      .from("design_submissions")
      .select("*")
      .eq("unique_id", uniqueId)
      .single();

    if (fetchError) {
      return res.status(400).json({ error: "Submission not found" });
    }

    // Prepare new notification fields
    const newRow = {
      user_id: submission.user_id,
      submission_id: uniqueId,
      company_name: submission.company_name,
      position_name: submission.position,
      last_viewed_at: new Date(),
      is_read: false
    };

    // 4. Insert new notification
    const { data: insertedData, error: insertError } = await supabase_connect
      .from("notifications")
      .insert([newRow])
      .select();

    if (insertError) {
      return res.status(500).json({ error: insertError.message });
    }

    return res.status(200).json({
      success: true,
      message: "Notification created",
      notification: insertedData[0]
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
