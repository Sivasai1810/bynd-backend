import express from "express";
import { supabase_connect } from "../supabase/set-up.js";
import verifyToken from "../middlewares/verifytoken.js";

const router = express.Router();

// Get all submissions for the authenticated user
router.get('', verifyToken, async (req, res) => {
  try {
    const user_id = req.user;
    console.log("Fetching data for user ID:", user_id);

    // Fetch user data from database
    const { data: userData, error } = await supabase_connect
      .from("user_urls")
      .select("*")
      .eq("user_id", user_id)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error("Fetch error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    // If user not found or no data
    if (!userData || !userData.shareable_link || userData.shareable_link.length === 0) {
      return res.status(200).json({ 
        message: "No submissions found",
        submissions: []
      });
    }

    // Transform arrays into array of objects
    const submissions = userData.shareable_link.map((link, index) => ({
      id: index + 1,
      shareable_link: link,
      companyname: userData.companyname[index] || 'N/A',
      position: userData.position[index] || 'N/A',
      status: userData.status[index] || 'pending',
      created_at: userData.created_at[index] || null,
      pasted_url: userData.pasted_url[index] || null,
      preview_url: userData.preview_url[index] || null,
      unique_id: userData.unique_id[index] || null
    }));

    // console.log(`Found ${submissions.length} submissions for user ${user_id}`);

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

// Get specific submission by unique_id (public route - no auth)
router.get('/public/:uniqueId', async (req, res) => {
  try {
    const { uniqueId } = req.params;

    if (!uniqueId) {
      return res.status(400).json({ error: "Missing unique ID" });
    }

    // Search all users for this unique_id
    const { data: allUsers, error } = await supabase_connect
      .from("user_urls")
      .select("*");

    if (error) {
      console.error("Fetch error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    // Find the user and index where this unique_id exists
    let foundSubmission = null;
    for (const user of allUsers) {
      if (user.unique_id && user.unique_id.includes(uniqueId)) {
        const index = user.unique_id.indexOf(uniqueId);
        
        foundSubmission = {
          shareable_link: user.shareable_link[index],
          companyname: user.companyname[index],
          position: user.position[index],
          status: user.status[index],
          created_at: user.created_at[index],
          pasted_url: user.pasted_url[index],
          preview_url: user.preview_url[index],
          unique_id: uniqueId
        };
        break;
      }
    }

    if (!foundSubmission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    return res.status(200).json({
      message: "Submission found",
      submission: foundSubmission
    });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Server error occurred" });
  }
});

export default router;