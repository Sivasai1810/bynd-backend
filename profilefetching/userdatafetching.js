import express from "express";
import { supabase_connect } from "../supabase/set-up.js";
import verifyToken from "../middlewares/verifytoken.js";

const router = express.Router();

// Get all submissions for the authenticated user
router.get('', async (req, res) => {
  try {
    const user_id = req.query.user_id;
    console.log("Fetching data for user ID:", user_id);

    // Fetch all submissions for this user with optimized query
    const { data: submissions, error } = await supabase_connect
      .from("design_submissions")
      .select("*")
      .eq("user_id", user_id)
      .order('created_at', { ascending: false }); // Most recent first

    if (error) {
      console.error("Fetch error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    // If no submissions found
    if (!submissions || submissions.length === 0) {
      return res.status(200).json({ 
        message: "No submissions found",
        submissions: []
      });
    }

    console.log(`Found ${submissions.length} submissions for user ${user_id}`);

    return res.status(200).json({
      message: "Data fetched successfully",
      count: submissions.length,
      submissions: submissions
    });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Server error occurred" });
  }
});

// Get specific submission by unique_id (public route - no auth needed)
router.get('/public/:uniqueId', async (req, res) => {
  try {
    const { uniqueId } = req.params;

    if (!uniqueId) {
      return res.status(400).json({ error: "Missing unique ID" });
    }

    // Direct indexed lookup - MUCH faster!
    const { data: submission, error } = await supabase_connect
      .from("design_submissions")
      .select("*")
      .eq('unique_id', uniqueId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return res.status(404).json({ error: "Submission not found" });
      }
      console.error("Fetch error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Optional: Track views asynchronously
    supabase_connect
      .from("design_submissions")
      .update({ 
        total_views: (submission.total_views || 0) + 1,
        last_viewed_at: new Date().toISOString()
      })
      .eq('id', submission.id)
      .then(() => {})
      .catch(err => console.error("View tracking error:", err));

    return res.status(200).json({
      message: "Submission found",
      submission: submission
    });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Server error occurred" });
  }
});

export default router;