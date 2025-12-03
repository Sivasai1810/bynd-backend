
import express from "express";
import { supabase_connect } from "../supabase/set-up.js";
import cookieParser from "cookie-parser";

const router = express.Router();
router.use(cookieParser());
router.use(express.json());

// Endpoint: Get dashboard analytics for a specific submission
router.get('/:uniqueId/dashboard-analytics', async (req, res) => {
  try {
    const { uniqueId } = req.params;

    if (!uniqueId) {
      return res.status(400).json({ 
        success: false,
        error: "Missing unique ID" 
      });
    }

    // Fetch design submission
    const { data: design, error: designError } = await supabase_connect
      .from("design_submissions")
      .select("id, created_at, position, company_name")
      .eq('unique_id', uniqueId)
      .single();

    if (designError || !design) {
      return res.status(404).json({ 
        success: false,
        error: "Design not found" 
      });
    }

    // Fetch analytics from submission_analytics table
    const { data: analytics, error: analyticsError } = await supabase_connect
      .from("submission_analytics")
      .select("*")
      .eq('submission_id', design.id)
      .single();

    // If no analytics exist yet, return default values
    if (analyticsError && analyticsError.code === 'PGRST116') {
      return res.json({
        success: true,
        data: {
          status: 'pending',
          totalViews: 0,
          uniqueViewers: 0,
          avgTimePerView: 0,
          submissionAge: Math.floor(
            (Date.now() - new Date(design.created_at).getTime()) / (1000 * 60 * 60 * 24)
          ),
          firstViewedOn: null,
          lastViewedAt: null,
          engagementScore: 0,
          engagementBreakdown: {
            high: 0,
            moderate: 0,
            low: 0
          },
          viewsOverTime: []
        }
      });
    }

    if (analyticsError) {
      console.error("Analytics fetch error:", analyticsError);
      return res.status(500).json({ 
        success: false,
        error: "Failed to fetch analytics" 
      });
    }

    // Calculate submission age in days
    const submissionAge = Math.floor(
      (Date.now() - new Date(design.created_at).getTime()) / (1000 * 60 * 60 * 24)
    );

    // Fetch engagement breakdown
    const { data: engagementData } = await supabase_connect
      .from("submission_views")
      .select("engaged, time_spent_seconds")
      .eq('submission_id', design.id);

    let engagementBreakdown = { high: 0, moderate: 0, low: 0 };
    
    if (engagementData && engagementData.length > 0) {
      engagementData.forEach(view => {
        if (view.time_spent_seconds >= 60) {
          engagementBreakdown.high++;
        } else if (view.time_spent_seconds >= 30) {
          engagementBreakdown.moderate++;
        } else {
          engagementBreakdown.low++;
        }
      });
    }

    // Fetch views over time (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: viewsData } = await supabase_connect
      .from("submission_views")
      .select("viewed_at")
      .eq('submission_id', design.id)
      .gte('viewed_at', sevenDaysAgo.toISOString())
      .order('viewed_at', { ascending: true });

    // Group views by day
    const viewsByDay = {};
    if (viewsData && viewsData.length > 0) {
      viewsData.forEach(view => {
        const date = new Date(view.viewed_at).toISOString().split('T')[0];
        viewsByDay[date] = (viewsByDay[date] || 0) + 1;
      });
    }

    // Convert to array format for chart
    const viewsOverTime = Object.entries(viewsByDay).map(([date, views]) => ({
      date,
      views
    }));    
 let engagementScore = 0;

// 1. Use DB score if available
if (analytics.engagement_score !== null && analytics.engagement_score !== undefined) {
  engagementScore = Math.round(analytics.engagement_score);
}

// 2. OR use alternate DB column (if named differently)
else if (analytics.engagementScore !== null && analytics.engagementScore !== undefined) {
  engagementScore = Math.round(analytics.engagementScore);
}

// 3. Otherwise fallback (low + moderate + high all count as engagement)
else {
  const total = analytics.total_views || 0;
  const engaged =
    engagementBreakdown.high +
    engagementBreakdown.moderate +
    engagementBreakdown.low;   

  engagementScore = total > 0 
    ? Math.round((engaged / total) * 100)
    : 0;
}


    // Return formatted analytics data
// In your backend getanalytics route - around the response section
res.json({
  success: true,
  data: {
    status: analytics.first_viewed_at ? 'viewed' : 'pending',
    totalViews: analytics.total_views || 0,
    uniqueViewers: analytics.unique_viewers || 0,  // ADD THIS LINE
    avgTimePerView: analytics.avg_time_per_view_seconds || 0,
    submissionAge: submissionAge,
    firstViewedOn: analytics.first_viewed_at,
    lastViewedAt: analytics.last_viewed_at,
    engagementScore: engagementScore,
    engagementBreakdown: engagementBreakdown,
    viewsOverTime: viewsOverTime,
    averagePagesViewed: analytics.avg_pages_viewed || 0
  }
});

  } catch (err) {
    console.error("Dashboard analytics error:", err);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch analytics",
      details: err.message 
    });
  }
});

export default router;