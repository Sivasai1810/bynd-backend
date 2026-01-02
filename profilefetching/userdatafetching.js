// import express from "express";
// import { supabase_connect } from "../supabase/set-up.js";

// const router = express.Router();

// // GET route to fetch user's submissions with stats
// router.get('', async (req, res) => {
//   try {
//     const { user_id } = req.query;

//     if (!user_id) {
//       return res.status(400).json({ 
//         success: false,
//         error: "Missing user_id parameter" 
//       });
//     }

//     // Fetch all submissions for this user
//     const { data: submissions, error } = await supabase_connect
//       .from("design_submissions")
//       .select("*")
//       .eq('user_id', user_id)
//       .order('created_at', { ascending: false });

//     if (error) {
//       console.error("Fetch error:", error.message);
//       return res.status(500).json({ 
//         success: false,
//         error: error.message 
//       });
//     }

//     // Handle empty submissions
//     if (!submissions || submissions.length === 0) {
//       return res.status(200).json({
//         success: true,
//         message: "No submissions found",
//         submissions: [],
//         stats: {
//           total_submissions: 0,
//           active_submissions: 0,
//           available_slots: 3,
//           total_assignments_viewed: 0,
//           last_viewed_assignment: null
//         }
//       });
//     }

//     // Calculate stats
//     const totalSubmissions = submissions.length;
    
//     // Check for last_viewed_at instead of total_views
//     const viewedSubmissions = submissions.filter(s => 
//       s.last_viewed_at !== null && s.last_viewed_at !== undefined
//     );
    
//     const totalAssignmentsViewed = viewedSubmissions.length;
    
//     // Find last viewed assignment
//     let lastViewedAssignment = null;
    
//     if (viewedSubmissions.length > 0) {
//       const sorted = [...viewedSubmissions].sort((a, b) => 
//         new Date(b.last_viewed_at) - new Date(a.last_viewed_at)
//       );
      
//       const mostRecent = sorted[0];
      
//       lastViewedAssignment = {
//         company_name: mostRecent.company_name,
//         position: mostRecent.position,
//         last_viewed_at: mostRecent.last_viewed_at,
//         unique_id: mostRecent.unique_id
//       };
//     }

//     // Return data with consistent structure
//     return res.status(200).json({
//       success: true,
//       message: "Data fetched successfully",
//       count: totalSubmissions,
//       submissions: submissions,
//       stats: {
//         total_submissions: totalSubmissions,
//         active_submissions: totalSubmissions,
//         available_slots: Math.max(3 - totalSubmissions, 0),
//         total_assignments_viewed: totalAssignmentsViewed,
//         last_viewed_assignment: lastViewedAssignment
//       }
//     });

//   } catch (err) {
//     console.error("Server error:", err);
//     res.status(500).json({ 
//       success: false,
//       error: "Server error occurred",
//       details: err.message 
//     });
//   }
// });

// export default router;


import express from "express";
import { supabase_connect } from "../supabase/set-up.js";
import { submissionsCache }from "../cache/submissionsCache.js"

const router = express.Router();


//  In-memory cache

const CACHE_TTL = 60 * 1000; 

router.get("", async (req, res) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: "Missing user_id parameter",
      });
    }

    
    const cached = submissionsCache.get(user_id);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json(cached.data);
    }

  
    const { data: submissions, error } = await supabase_connect
      .from("design_submissions")
      .select(`
        id,
        company_name,
        position,
        unique_id,
        shareable_link,
        created_at,
        last_viewed_at,
        status
      `)
      .eq("user_id", user_id)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }

    if (!submissions || submissions.length === 0) {
      const emptyResponse = {
        success: true,
        submissions: [],
        stats: {
          total_submissions: 0,
          active_submissions: 0,
          available_slots: 3,
          total_assignments_viewed: 0,
          last_viewed_assignment: null,
        },
      };

      submissionsCache.set(user_id, {
        data: emptyResponse,
        expiresAt: Date.now() + CACHE_TTL,
      });

      return res.json(emptyResponse);
    }

    //  Stats calculation (single pass)
    let totalViewed = 0;
    let lastViewed = null;

    for (const s of submissions) {
      if (s.last_viewed_at) {
        totalViewed++;

        if (
          !lastViewed ||
          new Date(s.last_viewed_at) > new Date(lastViewed.last_viewed_at)
        ) {
          lastViewed = s;
        }
      }
    }

    const response = {
      success: true,
      submissions,
      stats: {
        total_submissions: submissions.length,
        active_submissions: submissions.length,
        available_slots: Math.max(3 - submissions.length, 0),
        total_assignments_viewed: totalViewed,
        last_viewed_assignment: lastViewed
          ? {
              company_name: lastViewed.company_name,
              position: lastViewed.position,
              last_viewed_at: lastViewed.last_viewed_at,
              unique_id: lastViewed.unique_id,
            }
          : null,
      },
    };


    submissionsCache.set(user_id, {
      data: response,
      expiresAt: Date.now() + CACHE_TTL,
    });

    return res.json(response);

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Server error",
      details: err.message,
    });
  }
});

export default router;
