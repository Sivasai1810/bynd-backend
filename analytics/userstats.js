import express from "express";
import { supabase_connect } from "../supabase/set-up.js";

const router = express.Router();

// GET route to fetch user's submissions with stats
router.get('', async (req, res) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: "Missing user_id parameter" });
    }

    // Fetch all submissions for this user
    const { data: submissions, error } = await supabase_connect
      .from("design_submissions")
      .select("*")
      .eq('user_id', user_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error("Fetch error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    // Calculate stats
    const totalSubmissions = submissions.length;
    
    // Count designs that have been viewed (total_views > 0)
    const viewedSubmissions = submissions.filter(s => s.total_views > 0);
    const totalAssignmentsViewed = viewedSubmissions.length;
    
    // Find last viewed assignment
    let lastViewedAssignment = null;
    if (viewedSubmissions.length > 0) {
      const sorted = [...viewedSubmissions].sort((a, b) => 
        new Date(b.last_viewed_at) - new Date(a.last_viewed_at)
      );
      lastViewedAssignment = {
        company_name: sorted[0].company_name,
        position: sorted[0].position,
        last_viewed_at: sorted[0].last_viewed_at,
        total_views: sorted[0].total_views
      };
    }

    // Return data
    return res.status(200).json({
      success: true,
      submissions: submissions,
      stats: {
        total_submissions: totalSubmissions,
        active_submissions: totalSubmissions, // Same as total for now
        available_slots: Math.max(3 - totalSubmissions, 0),
        total_assignments_viewed: totalAssignmentsViewed,
        last_viewed_assignment: lastViewedAssignment
      }
    });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ 
      error: "Server error occurred",
      details: err.message 
    });
  }
});

export default router;