import cron from "node-cron";
import { supabase_connect } from "../supabase/set-up.js";

const STALE_SESSION_THRESHOLD = 30 * 60 * 1000; 
const CLEANUP_INTERVAL = "*/30 * * * *"; 


async function cleanupStaleSessions() {
  const startTime = Date.now();
  
  try {
    console.log("[Cleanup] Starting stale session cleanup...");

    const cutoffTime = new Date(Date.now() - STALE_SESSION_THRESHOLD).toISOString();

    const { data: staleSessions, error: fetchError } = await supabase_connect
      .from("design_view_sessions")
      .select("id, session_id, last_activity_at, total_time_spent")
      .eq("is_active", true)
      .lt("last_activity_at", cutoffTime);

    if (fetchError) {
      console.error("[Cleanup] Error fetching stale sessions:", fetchError);
      return;
    }

    if (!staleSessions || staleSessions.length === 0) {
      console.log("[Cleanup] ✓ No stale sessions found");
      return;
    }

    console.log(`[Cleanup] Found ${staleSessions.length} stale sessions`);

    const sessionIds = staleSessions.map(s => s.session_id);
    
    const { error: updateError } = await supabase_connect
      .from("design_view_sessions")
      .update({
        is_active: false,
        ended_at: supabase_connect.raw("last_activity_at")
      })
      .in("session_id", sessionIds);

    if (updateError) {
      console.error("[Cleanup] Error updating stale sessions:", updateError);
      return;
    }

    const duration = Date.now() - startTime;
    console.log(
      `[Cleanup] ✓ Marked ${staleSessions.length} sessions as inactive [${duration}ms]`
    );

    staleSessions.forEach(session => {
      const inactiveTime = Math.round(
        (Date.now() - new Date(session.last_activity_at).getTime()) / 1000 / 60
      );
      console.log(
        `  - ${session.session_id}: inactive for ${inactiveTime} min, ` +
        `total time: ${session.total_time_spent}s`
      );
    });

  } catch (err) {
    console.error("[Cleanup] Unexpected error:", err);
  }
}


async function getCleanupStats() {
  try {
    const { data, error } = await supabase_connect
      .from("design_view_sessions")
      .select("is_active");

    if (error) {
      console.error("[Cleanup] Error fetching stats:", error);
      return;
    }

    const totalSessions = data.length;
    const activeSessions = data.filter(s => s.is_active).length;
    const inactiveSessions = totalSessions - activeSessions;

  
  } catch (err) {
    console.error("[Cleanup] Error fetching stats:", err);
  }
}

export function initializeSessionCleanup() {
 

  // Run cleanup immediately on startup
  cleanupStaleSessions().then(() => {
    getCleanupStats();
  });

  // Schedule cleanup to run every 30 minutes
  cron.schedule(CLEANUP_INTERVAL, async () => {
   
    
    await cleanupStaleSessions();
    await getCleanupStats();
  });
}


export async function runManualCleanup() {
  await cleanupStaleSessions();
  await getCleanupStats();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runManualCleanup().then(() => {
    process.exit(0);
  });
}