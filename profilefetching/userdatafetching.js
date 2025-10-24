// import express from "express";
// import { supabase_connect } from "../supabase/set-up.js";
// import verifyToken from "../middlewares/verifytoken.js";

// const router = express.Router();

// // Get all submissions for the authenticated user
// router.get('', async (req, res) => {
//   try {
//     const user_id = req.query.user_id;
//     console.log("Fetching data for user ID:", user_id);

//     // Fetch all submissions for this user with optimized query
//     const { data: submissions, error } = await supabase_connect
//       .from("design_submissions")
//       .select("*")
//       .eq("user_id", user_id)
//       .order('created_at', { ascending: false }); // Most recent first

//     if (error) {
//       console.error("Fetch error:", error.message);
//       return res.status(500).json({ error: error.message });
//     }

//     // If no submissions found
//     if (!submissions || submissions.length === 0) {
//       return res.status(200).json({ 
//         message: "No submissions found",
//         submissions: []
//       });
//     }

//     console.log(`Found ${submissions.length} submissions for user ${user_id}`);

//     return res.status(200).json({
//       message: "Data fetched successfully",
//       count: submissions.length,
//       submissions: submissions
//     });

//   } catch (err) {
//     console.error("Server error:", err);
//     res.status(500).json({ error: "Server error occurred" });
//   }
// });

// // Get specific submission by unique_id (public route - no auth needed)
// router.get('/public/:uniqueId', async (req, res) => {
//   try {
//     const { uniqueId } = req.params;

//     if (!uniqueId) {
//       return res.status(400).json({ error: "Missing unique ID" });
//     }

//     // Direct indexed lookup - MUCH faster!
//     const { data: submission, error } = await supabase_connect
//       .from("design_submissions")
//       .select("*")
//       .eq('unique_id', uniqueId)
//       .single();

//     if (error) {
//       if (error.code === 'PGRST116') {
//         // No rows returned
//         return res.status(404).json({ error: "Submission not found" });
//       }
//       console.error("Fetch error:", error.message);
//       return res.status(500).json({ error: error.message });
//     }

//     if (!submission) {
//       return res.status(404).json({ error: "Submission not found" });
//     }

//     // Optional: Track views asynchronously
//     supabase_connect
//       .from("design_submissions")
//       .update({ 
//         total_views: (submission.total_views || 0) + 1,
//         last_viewed_at: new Date().toISOString()
//       })
//       .eq('id', submission.id)
//       .then(() => {})
//       .catch(err => console.error("View tracking error:", err));

//     return res.status(200).json({
//       message: "Submission found",
//       submission: submission
//     });

//   } catch (err) {
//     console.error("Server error:", err);
//     res.status(500).json({ error: "Server error occurred" });
//   }
// });

// export default router;

import express from "express";
import { supabase_connect } from "../supabase/set-up.js";

const router = express.Router();

// GET route to fetch user's submissions with stats
router.get('', async (req, res) => {
  try {
    const { user_id } = req.query;

    console.log("Fetching data for user ID:", user_id);

    if (!user_id) {
      return res.status(400).json({ 
        success: false,
        error: "Missing user_id parameter" 
      });
    }

    // Fetch all submissions for this user
    const { data: submissions, error } = await supabase_connect
      .from("design_submissions")
      .select("*")
      .eq('user_id', user_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error("Fetch error:", error.message);
      return res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }

    // Handle empty submissions
    if (!submissions || submissions.length === 0) {
      console.log("No submissions found for user:", user_id);
      return res.status(200).json({
        success: true,
        message: "No submissions found",
        submissions: [],
        stats: {
          total_submissions: 0,
          active_submissions: 0,
          available_slots: 3,
          total_assignments_viewed: 0,
          last_viewed_assignment: null
        }
      });
    }

    console.log(`Found ${submissions.length} submissions for user ${user_id}`);

    // Calculate stats
    const totalSubmissions = submissions.length;
    
    // Count designs that have been viewed (total_views > 0)
    const viewedSubmissions = submissions.filter(s => (s.total_views || 0) > 0);
    const totalAssignmentsViewed = viewedSubmissions.length;
    
    // Find last viewed assignment
    let lastViewedAssignment = null;
    if (viewedSubmissions.length > 0) {
      const sorted = [...viewedSubmissions].sort((a, b) => 
        new Date(b.last_viewed_at || 0) - new Date(a.last_viewed_at || 0)
      );
      lastViewedAssignment = {
        company_name: sorted[0].company_name,
        position: sorted[0].position,
        last_viewed_at: sorted[0].last_viewed_at,
        total_views: sorted[0].total_views
      };
    }

    // Return data with consistent structure
    return res.status(200).json({
      success: true,
      message: "Data fetched successfully",
      count: totalSubmissions,
      submissions: submissions,
      stats: {
        total_submissions: totalSubmissions,
        active_submissions: totalSubmissions,
        available_slots: Math.max(3 - totalSubmissions, 0),
        total_assignments_viewed: totalAssignmentsViewed,
        last_viewed_assignment: lastViewedAssignment
      }
    });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ 
      success: false,
      error: "Server error occurred",
      details: err.message 
    });
  }
});

export default router;