import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import { supabase_connect } from "../supabase/set-up.js";

const router = express.Router();

router.use(cookieParser());
router.use(express.json());

// Helper: fallback fingerprint (server-side hashed IP+UA) if client didn't send fp
function generateFallbackFingerprint(ip, userAgent) {
  return crypto
    .createHash("sha256")
    .update(`${ip}::${userAgent}`)
    .digest("hex")
    .substring(0, 32);
}

function generateSessionId() {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * POST /:uniqueId/start-session
 * Body expects: { deviceFingerprint?: string }
 *
 * Behavior:
 * - If client sends deviceFingerprint (recommended): use it to determine is_unique_viewer.
 * - Otherwise generate a fallback fingerprint from viewer IP + UA (less accurate).
 * - Always INSERT a new submission_views row (so total views increments).
 * - The DB trigger auto_refresh_analytics AFTER INSERT should recalc analytics.
 */
router.post("/:uniqueId/start-session", async (req, res) => {
  try {
    const { uniqueId } = req.params;
    if (!uniqueId) return res.status(400).json({ error: "Missing unique ID" });

    const viewerIp = (
      req.headers["x-forwarded-for"] ||
      req.ip ||
      req.connection?.remoteAddress ||
      ""
    )
      .toString()
      .split(",")[0]
      .trim();

    const userAgent = req.headers["user-agent"] || "unknown";

    // prefer explicit client device fingerprint
    let deviceFingerprint = (req.body && req.body.deviceFingerprint) || null;

    // fallback to server-side computed fingerprint (less ideal)
    if (!deviceFingerprint) {
      deviceFingerprint = generateFallbackFingerprint(viewerIp, userAgent);
    }

    // Fetch design
    const { data: design, error: designError } = await supabase_connect
      .from("design_submissions")
      .select("id")
      .eq("unique_id", uniqueId)
      .single();

    if (designError || !design) {
      return res.status(404).json({ error: "Design not found" });
    }

    const submissionId = design.id;
    const now = new Date().toISOString();

    // Update last_viewed_at and status (non-blocking)
    await supabase_connect
      .from("design_submissions")
      .update({ last_viewed_at: now, status: "viewed" })
      .eq("id", submissionId);

    // Check whether this deviceFingerprint has been used before for THIS submission
    const { data: existingDevice } = await supabase_connect
      .from("submission_views")
      .select("id")
      .eq("submission_id", submissionId)
      .eq("device_fingerprint", deviceFingerprint)
      .limit(1)
      .maybeSingle();

    const isUniqueViewer = !existingDevice;

    // Create a new session row to track total views/metrics
    const sessionId = generateSessionId();

    const insertPayload = {
      submission_id: submissionId,
      device_fingerprint: deviceFingerprint,
      viewer_ip: viewerIp,
      user_agent: userAgent,
      session_id: sessionId,
      viewed_at: now,
      // keep these flags for analytics/triggers in DB:
      is_unique_viewer: isUniqueViewer,
      // keep old fields too so existing queries continue to work
      viewer_fingerprint: deviceFingerprint, // optional - keep for compatibility
    };

    const { error: insertError } = await supabase_connect
      .from("submission_views")
      .insert(insertPayload);

    if (insertError) {
      console.error("Insert error:", insertError);
      return res.status(500).json({ error: "Failed to insert session" });
    }

    return res.json({ success: true, sessionId, isUniqueViewer });
  } catch (err) {
    console.error("start-session error:", err);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
});

/**
 * POST /:uniqueId/update-session
 * updates time spent/pages viewed for a given sessionId
 */
router.post("/:uniqueId/update-session", async (req, res) => {
  try {
    const { sessionId, timeSpent, pagesViewed, maxPageViewed } = req.body;
    if (!sessionId)
      return res.status(400).json({ error: "Missing session ID" });

    const engaged =
      (timeSpent || 0) >= 30 || (pagesViewed || 0) >= 3;

    const { error } = await supabase_connect
      .from("submission_views")
      .update({
        last_activity_at: new Date().toISOString(),
        time_spent_seconds: timeSpent || 0,
        pages_viewed: pagesViewed || 1,
        max_pages_viewed: maxPageViewed || pagesViewed || 1,
        engaged,
      })
      .eq("session_id", sessionId);

    if (error) {
      console.error("Session update error:", error);
      return res.status(500).json({ error: "Failed to update session" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("update-session error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Endpoint: Get submission analytics
router.get("/:uniqueId/analytics", async (req, res) => {
  try {
    const { uniqueId } = req.params;

    // Fetch design
    const { data: design, error: designError } = await supabase_connect
      .from("design_submissions")
      .select("id, created_at")
      .eq("unique_id", uniqueId)
      .single();

    if (designError || !design) {
      return res.status(404).json({ error: "Design not found" });
    }

    // Fetch analytics
    const { data: analytics, error: analyticsError } = await supabase_connect
      .from("submission_analytics")
      .select("*")
      .eq("submission_id", design.id)
      .single();

    if (analyticsError && analyticsError.code !== "PGRST116") {
      console.error("Analytics fetch error:", analyticsError);
    }

    // Calculate submission age in days
    const submissionAge = Math.floor(
      (Date.now() - new Date(design.created_at).getTime()) /
        (1000 * 60 * 60 * 24)
    );

    res.json({
      success: true,
      analytics: {
        totalViews: analytics?.total_views || 0,
        uniqueViewers: analytics?.unique_viewers || 0,
        averageTimePerView: analytics?.avg_time_per_view_seconds || 0,
        submissionAge,
        firstViewedAt: analytics?.first_viewed_at || null,
        lastViewedAt: analytics?.last_viewed_at || null,
        engagementScore: analytics?.engagement_score || 0,
        status: analytics?.first_viewed_at ? "viewed" : "pending",
        averagePagesViewed: analytics?.avg_pages_viewed || 0,
      },
    });
  } catch (err) {
    console.error("Analytics fetch error:", err);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// Endpoint: Refresh expired signed URLs
router.get("/:uniqueId/refresh-urls", async (req, res) => {
  try {
    const { uniqueId } = req.params;

    if (!uniqueId) {
      return res.status(400).json({ error: "Missing unique ID" });
    }

    const { data: design, error } = await supabase_connect
      .from("design_submissions")
      .select("*")
      .eq("unique_id", uniqueId)
      .single();

    if (error || !design) {
      return res.status(404).json({ error: "Design not found" });
    }

    let layers = [];

    if (design.design_type === "figma") {
      const { data: layersData, error: layersError } = await supabase_connect
        .from("design_layers")
        .select("*")
        .eq("submission_id", design.id)
        .order("layer_order", { ascending: true });

      if (!layersError && layersData && layersData.length > 0) {
        for (let layer of layersData) {
          const sanitizedLayerName = layer.layer_name.replace(
            /[^a-zA-Z0-9]/g,
            "_"
          );
          const imagePath = `${design.user_id}/${design.id}/${sanitizedLayerName}_${layer.layer_order}.png`;

          const { data: signedData, error: signedError } =
            await supabase_connect.storage
              .from("design_previews")
              .createSignedUrl(imagePath, 3600);

          if (!signedError && signedData && signedData.signedUrl) {
            layer.layer_preview_url = signedData.signedUrl;
          } else {
            layer.layer_preview_url = null;
          }
        }

        layers = layersData.map((layer) => ({
          layer_name: layer.layer_name || "Untitled",
          layer_order: layer.layer_order,
          layer_preview_url: layer.layer_preview_url || null,
        }));
      }
    }

    res.json({ success: true, layers, expiresIn: 3600 });
  } catch (err) {
    console.error("URL refresh error:", err);
    res
      .status(500)
      .json({ error: "Failed to refresh URLs", details: err.message });
  }
});

// Main preview route
router.get("/:uniqueId", async (req, res) => {
  try {
    const { uniqueId } = req.params;

    if (!uniqueId) {
      return res.status(400).json({ error: "Missing unique ID" });
    }

    const { data: design, error } = await supabase_connect
      .from("design_submissions")
      .select("*")
      .eq("unique_id", uniqueId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({ error: "Design not found" });
      }
      console.error("Fetch error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    if (!design) {
      return res.status(404).json({ error: "Design not found" });
    }

    // Update last_viewed_at and status
    try {
      const { error: updateError } = await supabase_connect
        .from("design_submissions")
        .update({
          last_viewed_at: new Date().toISOString(),
          status: "viewed",
        })
        .eq("id", design.id);

      if (updateError) {
        console.error("Failed to update last_viewed_at:", updateError);
      } else {
        console.log("last_viewed_at updated for preview:", uniqueId);
      }
    } catch (err) {
      console.error("Error updating last_viewed_at:", err);
    }

    // Fetch layers if Figma design
    let layers = [];

    if (design.design_type === "figma") {
      const { data: layersData, error: layersError } = await supabase_connect
        .from("design_layers")
        .select("*")
        .eq("submission_id", design.id)
        .order("layer_order", { ascending: true });

      if (!layersError && layersData && layersData.length > 0) {
        for (let layer of layersData) {
          const sanitizedLayerName = layer.layer_name.replace(
            /[^a-zA-Z0-9]/g,
            "_"
          );
          const imagePath = `${design.user_id}/${design.id}/${sanitizedLayerName}_${layer.layer_order}.png`;

          const { data: signedData, error: signedError } =
            await supabase_connect.storage
              .from("design_previews")
              .createSignedUrl(imagePath, 3600);

          if (!signedError && signedData && signedData.signedUrl) {
            layer.layer_preview_url = signedData.signedUrl;
          } else {
            console.error(
              `Could not fetch preview for layer: ${imagePath}`,
              signedError
            );
            layer.layer_preview_url = null;
          }
        }

        layers = layersData;
      }
    }

    const loadingDuration =
      layers.length > 8 ? 19000 : layers.length > 0 ? 10000 : 15000;

    // Generate signed URL for main preview thumbnail
    let previewImageUrl = null;
    if (design.preview_thumbnail) {
      const { data: signedData, error: signedError } =
        await supabase_connect.storage
          .from("design_previews")
          .createSignedUrl(design.preview_thumbnail, 3600);

      if (!signedError && signedData && signedData.signedUrl) {
        previewImageUrl = signedData.signedUrl;
      }
    }

    let fullViewUrl = null;
    if (design.design_type === "pdf") {
      const { data, error: signedUrlError } = await supabase_connect.storage
        .from("design_files")
        .createSignedUrl(design.pdf_file_path, 3600);

      if (signedUrlError) {
        console.error("Signed URL error:", signedUrlError);
        return res.status(500).json({ error: "Failed to generate PDF URL" });
      }
      fullViewUrl = `${data.signedUrl}#toolbar=0&navpanes=0&scrollbar=0`;
    }

    // Get default layer preview URL
    let defaultLayerUrl = null;
    if (
      design.design_type === "figma" &&
      layers.length > 0 &&
      layers[0].layer_preview_url
    ) {
      defaultLayerUrl = layers[0].layer_preview_url;
    }

    const layersJSON = JSON.stringify(
      layers.map((layer) => ({
        layer_name: layer.layer_name || "Untitled",
        layer_order: layer.layer_order,
        layer_preview_url: layer.layer_preview_url || null,
      }))
    );

    const totalLayers = layers.length;

    const dropdownHtml =
      design.design_type === "figma" && layers.length > 0
        ? `
            <div class="custom-dropdown" id="customDropdown">
              <div class="dropdown-trigger" id="dropdownTrigger">
                <div class="dropdown-label">
                  <span class="dropdown-label-prefix">Page:</span>
                  <span id="selectedOption">${
                    layers[0].layer_name || "Page 1"
                  }</span>
                </div>
                <svg class="dropdown-chevron" id="dropdownChevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M6 9l6 6 6-6"></path>
                </svg>
              </div>
              <div class="dropdown-menu" id="dropdownMenu">
                ${layers
                  .map(
                    (layer, idx) => `
                      <div class="dropdown-option ${
                        idx === 0 ? "selected" : ""
                      }" data-index="${idx}">
                        ${layer.layer_name || `Page ${idx + 1}`}
                      </div>`
                  )
                  .join("")}
              </div>
            </div>`
        : `<div></div>`;

    const previewInnerHtml =
      design.design_type === "figma"
        ? `
          <div class="screenshot-container" id="screenshotContainer">
            <div class="layer-loading-overlay" id="layerLoadingOverlay">
              <div class="mini-spinner"></div>
            </div>
            ${
              defaultLayerUrl
                ? `<img src="${defaultLayerUrl}" alt="Design Preview" class="preview-image loading" id="previewImage">`
                : `<div class="error-message">No preview available for this design.</div>`
            }
          </div>`
        : `
          <div class="iframe-container" id="iframeContainer">
            <div class="loading-overlay" id="loadingOverlay">
              <div class="spinner"></div>
              <div class="loading-text-small">Loading PDF...</div>
            </div>
            <iframe id="designFrame" class="design-frame" src="${fullViewUrl}"></iframe>
          </div>`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${design.position} - ${design.company_name}</title>
  <script>
    // Load FingerprintJS and create global getter
    async function loadFingerprint() {
      const fp = await FingerprintJS.load();
      const result = await fp.get();
      return result.visitorId;
    }
  </script>
  <script src="https://cdn.jsdelivr.net/npm/@fingerprintjs/fingerprintjs@3/dist/fp.min.js"></script>
  <style>
    @font-face {
      font-family: 'Circular Std';
      src: url('/fonts/circular-std/CircularStd-Book.ttf') format('truetype');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Circular Std';
      src: url('/fonts/circular-std/CircularStd-Medium.ttf') format('truetype');
      font-weight: 500;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Circular Std';
      src: url('/fonts/circular-std/CircularStd-Bold.ttf') format('truetype');
      font-weight: 700;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Circular Std';
      src: url('/fonts/circular-std/CircularStd-Black.ttf') format('truetype');
      font-weight: 900;
      font-style: normal;
      font-display: swap;
    }
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      font-family: 'Circular Std', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', sans-serif;
    }
    body {
      background: #FFFFFF;
      min-height: 100vh;
      color: #111827;
    }
    .loading-screen {
      position: fixed;
      inset: 0;
      background: #FFFFFF;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      transition: opacity 0.5s ease;
    }
    .loading-screen.fade-out {
      opacity: 0;
      pointer-events: none;
    }
    .loading-logo {
      font-size: 28px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 24px;
      letter-spacing: -0.5px;
    }
    .loading-spinner {
      width: 48px;
      height: 48px;
      border: 4px solid #E5E7EB;
      border-top: 4px solid #3B82F6;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 16px;
    }
    .loading-text {
      color: #6B7280;
      font-size: 15px;
      font-weight: 500;
      margin-bottom: 8px;
    }
    .loading-subtext {
      color: #9CA3AF;
      font-size: 13px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .main-content {
      opacity: 0;
      transition: opacity 0.5s ease;
    }
    .main-content.visible {
      opacity: 1;
    }
    .navbar {
      background: #FFFFFF;
      padding: 20px 0;
      border-bottom: 2px solid #E5E7EB;
    }
    .nav-content {
      max-width: 1400px;
      margin: 0 auto;
      padding: 0 32px;
    }
    .nav-title {
      font-size: 22px;
      font-weight: 600;
      color: #111827;
      margin-bottom: 6px;
    }
    .nav-meta {
      font-size: 16px;
      color: #6B7280;
    }
    .page-container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 0 32px 24px 32px;
      display: grid;
      grid-template-columns: 1fr 300px;
      gap: 24px;
      align-items: start;
    }
    .content-area {
      background: #F9FAFB;
      border-radius: 0;
      padding: 24px 20px 20px 20px;
      min-height: 600px;
      position: relative;
    }
    .custom-dropdown {
      position: relative;
      width: 210px;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .dropdown-trigger {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid #E5E7EB;
      border-radius: 6px;
      background-color: #FFFFFF;
      font-size: 12px;
      font-weight: 500;
      color: #1A1A1A;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: all 0.2s ease;
      user-select: none;
    }
    .dropdown-trigger:hover {
      background-color: #FAFAFA;
      border-color: #D1D5DB;
    }
    .dropdown-trigger.open {
      border-color: #3972EA;
      box-shadow: 0 0 0 3px rgba(57, 114, 234, 0.1);
    }
    .dropdown-trigger.disabled {
      opacity: 0.5;
      cursor: not-allowed;
      pointer-events: none;
    }
    .dropdown-label {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .dropdown-label-prefix {
      color: #6B7280;
      font-size: 12px;
      font-weight: 400;
    }
    .dropdown-chevron {
      width: 16px;
      height: 16px;
      color: #6B7280;
      transition: transform 0.2s ease;
    }
    .dropdown-chevron.rotate {
      transform: rotate(180deg);
    }
    .dropdown-menu {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      right: 0;
      background: #FFFFFF;
      border: 1px solid #E5E7EB;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
      overflow: hidden;
      max-height: 300px;
      overflow-y: auto;
      z-index: 1000;
      display: none;
      animation: fadeIn 0.15s ease;
    }
    .dropdown-menu.show {
      display: block;
    }
    .dropdown-option {
      padding: 10px 14px;
      font-size: 14px;
      color: #1A1A1A;
      font-weight: 400;
      cursor: pointer;
      transition: background-color 0.15s ease;
    }
    .dropdown-option:hover {
      background-color: #F5F6F8;
    }
    .dropdown-option.selected {
      background-color: #F5F6F8;
      font-weight: 500;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .preview-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      gap: 12px;
    }
    .preview-controls {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .expand-btn {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      border: 1px solid #E5E7EB;
      background: white;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s;
    }
    .expand-btn:hover {
      background: #F9FAFB;
      border-color: #D1D5DB;
    }
    .preview-area {
      background: #FFFFFF;
      border-radius: 20px;
      overflow: hidden;
      min-height: 600px;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .screenshot-container {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      min-height: 600px;
    }
    .preview-image {
      max-width: 100%;
      max-height: 700px;
      width: auto;
      height: auto;
      object-fit: contain;
      display: block;
      transition: opacity 0.3s ease;
      margin: auto;
    }
    .preview-image.loading {
      opacity: 0.3;
    }
    .layer-loading-overlay {
      position: absolute;
      inset: 0;
      background: rgba(255,255,255,0.9);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 5;
    }
    .layer-loading-overlay.show {
      display: flex;
    }
    .mini-spinner {
      width: 32px;
      height: 32px;
      border: 3px solid #E5E7EB;
      border-top: 3px solid #3B82F6;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    .iframe-container {
      width: 100%;
      max-width: 95%;
      height: 100%;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 600px;
    }
    .design-frame {
      width: 100%;
      height: 600px;
      border: none;
      display: block;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      border-radius: 8px;
    }
    .loading-overlay {
      position: absolute;
      inset: 0;
      background: rgba(255,255,255,0.98);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 10;
    }
    .loading-overlay.hidden {
      display: none;
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid #E5E7EB;
      border-top: 3px solid #3B82F6;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    .loading-text-small {
      margin-top: 12px;
      color: #6B7280;
      font-size: 14px;
      font-weight: 500;
    }
    .error-message {
      padding: 16px;
      background: #FEE2E2;
      border: 1px solid #FCA5A5;
      border-radius: 8px;
      color: #991B1B;
      font-size: 14px;
      text-align: center;
    }
    .preview-area:fullscreen {
      background: #F9FAFB;
      padding: 40px;
    }
    .preview-area:fullscreen .preview-image {
      max-height: 90vh;
      max-width: 90vw;
    }
    .preview-area:fullscreen .design-frame {
      height: 90vh;
      max-width: 90vw;
    }
    .info-column {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding-top: 24px;
    }
    .info-panel.usage-terms {
      background: #FFFFFF;
      border-radius: 10px;
      overflow: hidden;
      border: 1px solid #FDE68A;
    }
    .info-panel.usage-terms h3 {
      font-size: 16px;
      font-weight: 600;
      color: #92400E;
      background: #FFFBEB;
      padding: 14px 16px;
      margin: 0;
      border-bottom: 1px solid #FDE68A;
    }
    .info-panel.usage-terms ul {
      margin-left: 18px;
      color: #374151;
      font-size: 13px;
      line-height: 1.7;
      padding: 16px;
    }
    .info-panel.usage-terms li {
      margin-bottom: 6px;
    }
    .info-panel.documentation {
      background: #FFFFFF;
      border-radius: 10px;
      overflow: hidden;
      border: 1px solid #BFDBFE;
    }
    .info-panel.documentation h3 {
      font-size: 16px;
      font-weight: 600;
      color: #1E40AF;
      background: #EFF6FF;
      padding: 14px 16px;
      margin: 0;
      border-bottom: 1px solid #BFDBFE;
    }
    .info-panel.documentation ul {
      margin-left: 18px;
      color: #374151;
      font-size: 13px;
      line-height: 1.7;
      padding: 16px;
    }
    .info-panel.documentation li {
      margin-bottom: 6px;
    }
    @media (max-width: 1100px) {
      .page-container {
        grid-template-columns: 1fr;
        padding: 20px;
        gap: 20px;
      }
      .design-frame {
        height: 500px;
      }
      .info-column {
        flex-direction: row;
        gap: 16px;
      }
      .info-panel {
        flex: 1;
      }
    }
    @media (max-width: 768px) {
      .page-container {
        padding: 16px;
      }
      .navbar {
        padding: 16px 0;
      }
      .nav-content {
        padding: 0 20px;
      }
      .nav-title {
        font-size: 18px;
      }
      .nav-meta {
        font-size: 14px;
      }
      .preview-header {
        flex-direction: column;
        align-items: flex-start;
      }
      .preview-controls {
        width: 100%;
        justify-content: flex-end;
      }
      .info-column {
        flex-direction: column;
      }
      .preview-area {
        min-height: 400px;
        padding: 15px;
      }
      .screenshot-container {
        min-height: 400px;
      }
      .preview-image {
        max-height: 500px;
      }
      .design-frame {
        height: 450px;
      }
      .loading-logo {
        font-size: 24px;
      }
      .custom-dropdown {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="loading-screen" id="loadingScreen">
    <div class="loading-logo">The BYND</div>
    <div class="loading-spinner"></div>
    <div class="loading-text">Loading design submission...</div>
    <div class="loading-subtext">Preparing ${
      layers.length > 0 ? `${layers.length} pages` : "your preview"
    }</div>
  </div>
  <div class="main-content" id="mainContent">
    <div class="navbar">
      <div class="nav-content">
        <div class="nav-title">${design.position}</div>
        <div class="nav-meta">${design.company_name} • Submitted on ${new Date(
          design.created_at
        ).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })}</div>
      </div>
    </div>
    <div class="page-container">
      <div class="content-area">
        <div class="preview-header">
          ${dropdownHtml}
          <div class="preview-controls">
            <button class="expand-btn" onclick="toggleFullscreen()" title="Expand to fullscreen">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
              </svg>
            </button>
          </div>
        </div>
        <div class="preview-area" id="previewArea">
          ${previewInnerHtml}
        </div>
      </div>
      <div class="info-column">
        <div class="info-panel usage-terms">
          <h3>Usage Terms</h3>
          <ul>
            <li>This design is shared for evaluation purposes only.</li>
            <li>The content is the intellectual property of the applicant.</li>
            <li>Redistribution, duplication, or reuse is discouraged and may be subject to follow-up.</li>
          </ul>
        </div>
        <div class="info-panel documentation">
          <h3>Documentation Notice</h3>
          <ul>
            <li>This submission is documented by The BYND with activity logs, timestamps, and owner details.</li>
            <li>Viewing this assignment logs your access and supports a fair review process.</li>
            <li>The BYND helps ensure the designer receives credit for their work through transparent documentation.</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
  <script>
    // ========================================
    // ANALYTICS TRACKING - CONSOLIDATED
    // ========================================
    console.log('🔧 Analytics script loaded');

    // Analytics variables
    let sessionId = null;
    let startTime = Date.now();
    let currentPage = 1;
    let maxPageViewed = 1;
    let totalLayers = ${totalLayers};
    let trackingInterval = null;

    // Initialize session
    async function initSession() {
      console.log("Initialising Fingerprint...");
      const deviceFingerprint = await loadFingerprint(); // Critical
      console.log("Fingerprint:", deviceFingerprint);
      try {
        const response = await fetch('/BYNDLINK/view/${uniqueId}/start-session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ deviceFingerprint })
        });
        const data = await response.json();
        console.log("Session start response:", data);
        if (data.success) {
          sessionId = data.sessionId;
          startTracking();
        }
      } catch (err) {
        console.error("initSession error:", err);
      }
    }

    // Start tracking interval
    function startTracking() {
      console.log('⏰ Starting tracking interval (10s)');
      trackingInterval = setInterval(() => {
        updateSession();
      }, 10000);
    }

    // Update session with current metrics
    async function updateSession() {
      if (!sessionId) {
        console.warn('⚠️ No session ID, skipping update');
        return;
      }
      const timeSpent = Math.floor((Date.now() - startTime) / 1000);
      console.log('📤 Updating session:', { timeSpent, currentPage, maxPageViewed });
      try {
        const response = await fetch('/BYNDLINK/view/${uniqueId}/update-session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            sessionId: sessionId,
            timeSpent: timeSpent,
            pagesViewed: currentPage,
            maxPageViewed: maxPageViewed
          })
        });
        const data = await response.json();
        console.log('✓ Session updated:', data);
      } catch (err) {
        console.error('❌ Session update error:', err);
      }
    }

    // Track page changes
    function trackPageView(pageIndex) {
      currentPage = pageIndex + 1;
      maxPageViewed = Math.max(maxPageViewed, currentPage);
      console.log('📄 Page viewed: ' + currentPage + '/' + totalLayers);
      // Immediately update session
      updateSession();
    }

    // Final update before leaving
    window.addEventListener('beforeunload', () => {
      if (sessionId) {
        const timeSpent = Math.floor((Date.now() - startTime) / 1000);
        const data = JSON.stringify({
          sessionId: sessionId,
          timeSpent: timeSpent,
          pagesViewed: currentPage,
          maxPageViewed: maxPageViewed
        });
        console.log('👋 Sending final beacon:', data);
        navigator.sendBeacon(
          '/BYNDLINK/view/${uniqueId}/update-session',
          new Blob([data], { type: 'application/json' })
        );
      }
    });

    // ========================================
    // LAYER SWITCHING & UI CODE
    // ========================================
    let layers = [];
    try {
      layers = ${layersJSON};
    } catch (e) {
      console.error('Failed to parse layers:', e);
      layers = [];
    }

    const designType = '${design.design_type}';
    const loadingDuration = ${loadingDuration};
    const uniqueId = '${uniqueId}';
    let currentLayerIndex = 0;
    let isLayerSwitching = false;
    let isInitialized = false;
    let urlsExpireAt = Date.now() + 3600 * 1000;
    const preloadedImages = new Map();
    let isRefreshingUrls = false;

    const loadingScreen = document.getElementById('loadingScreen');
    const mainContent = document.getElementById('mainContent');
    const previewArea = document.getElementById('previewArea');
    const screenshotContainer = document.getElementById('screenshotContainer');
    const previewImage = document.getElementById('previewImage');
    const layerLoadingOverlay = document.getElementById('layerLoadingOverlay');
    const iframeContainer = document.getElementById('iframeContainer');
    const designFrame = document.getElementById('designFrame');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const customDropdown = document.getElementById('customDropdown');
    const dropdownTrigger = document.getElementById('dropdownTrigger');
    const dropdownMenu = document.getElementById('dropdownMenu');
    const dropdownChevron = document.getElementById('dropdownChevron');
    const selectedOption = document.getElementById('selectedOption');

    console.log('Design type:', designType);
    console.log('Total layers:', layers.length);

    function areUrlsExpired() {
      const fiveMinutes = 5 * 60 * 1000;
      return Date.now() > urlsExpireAt - fiveMinutes;
    }

    async function refreshLayerUrls() {
      if (isRefreshingUrls) {
        console.log('Already refreshing URLs...');
        return false;
      }
      isRefreshingUrls = true;
      console.log('🔄 Refreshing expired URLs...');
      try {
        const response = await fetch('/BYNDLINK/view/' + uniqueId + '/refresh-urls');
        if (!response.ok) {
          throw new Error('Failed to refresh URLs');
        }
        const data = await response.json();
        if (data.layers && Array.isArray(data.layers)) {
          data.layers.forEach((newLayer, idx) => {
            if (layers[idx] && newLayer.layer_preview_url) {
              layers[idx].layer_preview_url = newLayer.layer_preview_url;
            }
          });
          preloadedImages.clear();
          urlsExpireAt = Date.now() + 3600 * 1000;
          preloadAllLayers();
          console.log('✓ URLs refreshed successfully');
          isRefreshingUrls = false;
          return true;
        } else {
          throw new Error('Invalid response format');
        }
      } catch (error) {
        console.error('✗ Failed to refresh URLs:', error);
        isRefreshingUrls = false;
        return false;
      }
    }

    function preloadAllLayers() {
      if (designType !== 'figma' || layers.length === 0) return;
      console.log('Starting preload of', layers.length, 'layers...');
      layers.forEach((layer, idx) => {
        if (layer && layer.layer_preview_url) {
          const img = new Image();
          img.onload = () => {
            preloadedImages.set(idx, img);
            console.log('✓ Preloaded layer ' + idx + ': ' + layer.layer_name);
          };
          img.onerror = (e) => {
            console.error('✗ Failed to preload layer ' + idx + ': ' + layer.layer_name, e);
          };
          img.src = layer.layer_preview_url;
        } else {
          console.warn('Layer ' + idx + ' has no preview URL');
        }
      });
    }

    if (customDropdown && dropdownTrigger && dropdownMenu && layers.length > 0) {
      dropdownTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isLayerSwitching) return;
        const isOpen = dropdownMenu.classList.contains('show');
        if (isOpen) {
          closeDropdown();
        } else {
          openDropdown();
        }
      });

      const dropdownOptions = dropdownMenu.querySelectorAll('.dropdown-option');
      dropdownOptions.forEach((option) => {
        option.addEventListener('click', (e) => {
          e.stopPropagation();
          const index = parseInt(option.getAttribute('data-index'));
          if (!isNaN(index)) {
            selectOption(index);
          }
        });
      });

      document.addEventListener('click', (e) => {
        if (!customDropdown.contains(e.target)) {
          closeDropdown();
        }
      });

      function openDropdown() {
        dropdownMenu.classList.add('show');
        dropdownTrigger.classList.add('open');
        dropdownChevron.classList.add('rotate');
      }

      function closeDropdown() {
        dropdownMenu.classList.remove('show');
        dropdownTrigger.classList.remove('open');
        dropdownChevron.classList.remove('rotate');
      }

      function selectOption(index) {
        if (index === currentLayerIndex || index < 0 || index >= layers.length) {
          closeDropdown();
          return;
        }
        if (selectedOption && layers[index]) {
          selectedOption.textContent = layers[index].layer_name || 'Page ' + (index + 1);
        }
        dropdownOptions.forEach((opt, idx) => {
          if (idx === index) {
            opt.classList.add('selected');
          } else {
            opt.classList.remove('selected');
          }
        });
        closeDropdown();
        switchLayer(index);
      }
    }

    async function switchLayer(layerIndex) {
      if (isLayerSwitching || layerIndex === currentLayerIndex || layers.length === 0) {
        console.log('Switch prevented:', { isLayerSwitching, layerIndex, currentLayerIndex });
        return;
      }
      const layer = layers[layerIndex];
      if (!layer || !layer.layer_preview_url || !previewImage) {
        console.error('Cannot switch to layer:', layerIndex, layer);
        return;
      }

      if (areUrlsExpired()) {
        console.log('⏰ URLs expired, refreshing...');
        const refreshed = await refreshLayerUrls();
        if (!refreshed) {
          alert('Preview links have expired. Please refresh the page.');
          return;
        }
      }

      console.log('Switching from layer ' + currentLayerIndex + ' to ' + layerIndex);
      isLayerSwitching = true;

      if (dropdownTrigger) {
        dropdownTrigger.classList.add('disabled');
      }
      if (layerLoadingOverlay) {
        layerLoadingOverlay.classList.add('show');
      }
      previewImage.classList.add('loading');

      if (preloadedImages.has(layerIndex)) {
        const cachedImg = preloadedImages.get(layerIndex);
        if (cachedImg.complete && cachedImg.naturalHeight > 0) {
          previewImage.src = cachedImg.src;
          setTimeout(() => {
            previewImage.classList.remove('loading');
            if (layerLoadingOverlay) {
              layerLoadingOverlay.classList.remove('show');
            }
            if (dropdownTrigger) {
              dropdownTrigger.classList.remove('disabled');
            }
            isLayerSwitching = false;
            currentLayerIndex = layerIndex;
            console.log('✓ Switched to layer ' + layerIndex + ' (from cache)');
            // Track page view for analytics
            trackPageView(layerIndex);
          }, 150);
          return;
        } else {
          preloadedImages.delete(layerIndex);
        }
      }

      const img = new Image();
      const timeoutId = setTimeout(() => {
        console.error('Image load timeout for layer', layerIndex);
        img.onerror(new Error('Timeout'));
      }, 10000);

      img.onload = () => {
        clearTimeout(timeoutId);
        previewImage.src = img.src;
        preloadedImages.set(layerIndex, img);
        setTimeout(() => {
          previewImage.classList.remove('loading');
          if (layerLoadingOverlay) {
            layerLoadingOverlay.classList.remove('show');
          }
          if (dropdownTrigger) {
            dropdownTrigger.classList.remove('disabled');
          }
          isLayerSwitching = false;
          currentLayerIndex = layerIndex;
          console.log('✓ Switched to layer ' + layerIndex + ' (newly loaded)');
          // Track page view for analytics
          trackPageView(layerIndex);
        }, 150);
      };

      img.onerror = async (e) => {
        clearTimeout(timeoutId);
        console.error('✗ Failed to load layer ' + layerIndex + ': ' + layer.layer_name, e);

        if (!areUrlsExpired()) {
          console.log('Image failed but URLs not expired, forcing refresh...');
        }

        const refreshed = await refreshLayerUrls();
        if (refreshed) {
          const retryImg = new Image();
          retryImg.onload = () => {
            previewImage.src = retryImg.src;
            preloadedImages.set(layerIndex, retryImg);
            previewImage.classList.remove('loading');
            if (layerLoadingOverlay) {
              layerLoadingOverlay.classList.remove('show');
            }
            if (dropdownTrigger) {
              dropdownTrigger.classList.remove('disabled');
            }
            isLayerSwitching = false;
            currentLayerIndex = layerIndex;
            console.log('✓ Switched to layer ' + layerIndex + ' (after refresh)');
            trackPageView(layerIndex);
          };
          retryImg.onerror = () => {
            previewImage.classList.remove('loading');
            if (layerLoadingOverlay) {
              layerLoadingOverlay.classList.remove('show');
            }
            if (dropdownTrigger) {
              dropdownTrigger.classList.remove('disabled');
            }
            isLayerSwitching = false;
            alert('Failed to load page: ' + layer.layer_name + '. Please refresh the page.');
          };
          retryImg.src = layers[layerIndex].layer_preview_url;
        } else {
          previewImage.classList.remove('loading');
          if (layerLoadingOverlay) {
            layerLoadingOverlay.classList.remove('show');
          }
          if (dropdownTrigger) {
            dropdownTrigger.classList.remove('disabled');
          }
          isLayerSwitching = false;
          alert('Failed to load page: ' + layer.layer_name + '. Please refresh the page.');
        }
      };

      img.src = layer.layer_preview_url;
    }

    function toggleFullscreen() {
      if (!document.fullscreenElement) {
        previewArea.requestFullscreen().catch((err) =>
          console.error('Fullscreen error:', err)
        );
      } else {
        document.exitFullscreen();
      }
    }

    // Initialize page after loading duration
    setTimeout(() => {
      console.log('Hiding loading screen...');
      loadingScreen.classList.add('fade-out');
      mainContent.classList.add('visible');
      setTimeout(() => {
        loadingScreen.style.display = 'none';
        isInitialized = true;
        console.log('Page initialized');
        // Initialize analytics AFTER page is ready
        console.log('🎯 Starting analytics initialization...');
        initSession();
      }, 500);

      if (designType === 'figma' && layers.length > 0) {
        preloadAllLayers();
        if (previewImage) {
          const firstImageLoaded = new Promise((resolve, reject) => {
            if (previewImage.complete && previewImage.naturalHeight > 0) {
              resolve();
            } else {
              previewImage.onload = resolve;
              previewImage.onerror = reject;
            }
          });

          firstImageLoaded
            .then(() => {
              console.log('✓ First image loaded successfully');
              previewImage.classList.remove('loading');
            })
            .catch((e) => {
              console.error('✗ First image failed to load:', e);
              previewImage.classList.remove('loading');
              if (screenshotContainer) {
                screenshotContainer.innerHTML =
                  '<div class="error-message">Failed to load preview image. Please refresh the page.</div>';
              }
            });

          setTimeout(() => {
            if (previewImage.classList.contains('loading')) {
              console.warn('Image load timeout - removing loading state');
              previewImage.classList.remove('loading');
            }
          }, 3000);
        }
      }
    }, loadingDuration);

    if (designType === 'pdf' && designFrame && loadingOverlay) {
      let pdfLoaded = false;
      designFrame.onload = () => {
        if (!pdfLoaded) {
          pdfLoaded = true;
          console.log('✓ PDF loaded successfully');
          loadingOverlay.classList.add('hidden');
        }
      };
      setTimeout(() => {
        if (!pdfLoaded) {
          console.warn('PDF load timeout - hiding overlay');
          loadingOverlay.classList.add('hidden');
          pdfLoaded = true;
        }
      }, 5000);
    }
  </script>
</body>
</html>`;

    res.send(html);
  } catch (err) {
    console.error("Server error:", err);
    res
      .status(500)
      .json({ error: "Server error occurred", details: err.message });
  }
});

export default router;


 