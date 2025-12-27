import express from "express";
import { supabase_connect } from "../supabase/set-up.js";

const router = express.Router();

router.get("/:uniqueId/dashboard-analytics", async (req, res) => {
  try {
    const { uniqueId } = req.params;
    if (!uniqueId) {
      return res.status(400).json({
        success: false,
        error: "Missing unique ID",
      });
    }

    /* Resolve submission */
    const { data: submission, error: submissionError } =
      await supabase_connect
        .from("design_submissions")
        .select("id, created_at,status, position, company_name")
        .eq("unique_id", uniqueId)
        .single();

    if (submissionError || !submission) {
      return res.status(404).json({
        success: false,
        error: "Design not found",
      });
    }

    /* Fetch analytics from submission_view_stats */
    const { data: stats, error: statsError } =
      await supabase_connect
        .from("submission_view_stats")
        .select("*")
        .eq("submission_id", submission.id)
        .single();

    // Submission age (days)
    const submissionAge = Math.floor(
      (Date.now() - new Date(submission.created_at).getTime()) /
        (1000 * 60 * 60 * 24)
    );

    /*  If no analytics yet */
    if (statsError || !stats) {
      return res.json({
        success: true,
        data: {
          status: "pending",
          totalViews: 0,
          uniqueViewers: 0,
          avgTimePerView: 0,
          submissionAge,
          firstViewedOn: null,
          lastViewedAt: null,
          engagementScore: 0,
          engagementBreakdown: {
            high: 0,
            moderate: 0,
            low: 0,
          },
          viewsOverTime: [],
          averagePagesViewed: 0,
        },
      });
    }

    
    const totalSessions = stats.sessions_count || 0;
    const avgTime = stats.avg_time_spent || 0;

    let engagementBreakdown = { high: 0, moderate: 0, low: 0 };

    if (totalSessions > 0) {
      if (avgTime >= 60) engagementBreakdown.high = totalSessions;
      else if (avgTime >= 30) engagementBreakdown.moderate = totalSessions;
      else engagementBreakdown.low = totalSessions;
    }

    let engagementScore = 0;

    if (stats.engagement_score !== null && stats.engagement_score !== undefined) {
      engagementScore = Math.round(stats.engagement_score);
    } else if (stats.total_views > 0) {
      engagementScore = Math.round(
        (Math.min(stats.avg_time_spent || 0, 120) / 120) * 100
      );
    }

    const { data: dailyViews, error: dailyError } =
  await supabase_connect
    .from("submission_daily_views")
    .select("view_date, views")
    .eq("submission_id", submission.id)
    .order("view_date", { ascending: true });

  

if (dailyError) {
  console.error("[DASHBOARD] Daily views fetch error:", dailyError);
}

const viewsOverTime = (dailyViews || []).map(row => ({
  date: row.view_date,
  views: row.views,
}));


   

    res.json({
      success: true,
      data: {

        status: submission.status || "pending",

        totalViews: stats.total_views || 0,
        uniqueViewers: stats.unique_views || 0,
        avgTimePerView: stats.avg_time_spent || 0,
            createdAt: submission.created_at,
        submissionAge,
        firstViewedOn: stats.first_viewed_at,
        lastViewedAt: stats.last_viewed_at,
        engagementScore,
        engagementBreakdown,
        viewsOverTime,
        averagePagesViewed: 0,
      },
    });
  } catch (err) {
    console.error("Dashboard analytics error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch analytics",
      details: err.message,
    });
  }
});

export default router;