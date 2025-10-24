// import express from "express";
// import { supabase_connect } from "../supabase/set-up.js";

// const router = express.Router();

// // Get preview by unique ID
// router.get('/:uniqueId', async (req, res) => {
//   try {
//     const { uniqueId } = req.params;

//     if (!uniqueId) {
//       return res.status(400).json({ error: "Missing unique ID" });
//     }

//     // Direct indexed lookup
//     const { data: design, error } = await supabase_connect
//       .from("design_submissions")
//       .select("*")
//       .eq('unique_id', uniqueId)
//       .single();

//     if (error) {
//       if (error.code === 'PGRST116') {
//         return res.status(404).json({ error: "Design not found" });
//       }
//       console.error("Fetch error:", error.message);
//       return res.status(500).json({ error: error.message });
//     }

//     if (!design) {
//       return res.status(404).json({ error: "Design not found" });
//     }

//     // Track views asynchronously
//     supabase_connect
//       .from("design_submissions")
//       .update({ 
//         total_views: (design.total_views || 0) + 1,
//         last_viewed_at: new Date().toISOString()
//       })
//       .eq('id', design.id)
//       .then(() => {})
//       .catch(err => console.error("View tracking error:", err));

//     // Determine URLs
//     let previewImageUrl = design.preview_thumbnail;
//     let fullViewUrl = design.embed_url;
    
//     if (design.design_type === 'pdf') {
//       const { data } = supabase_connect.storage
//         .from('design_files')
//         .getPublicUrl(design.pdf_file_path);
//       fullViewUrl = data.publicUrl;
//     }

//     // Return optimized HTML with screenshot preview
//     const html = `
//     <!DOCTYPE html>
//     <html lang="en">
//     <head>
//       <meta charset="UTF-8">
//       <meta name="viewport" content="width=device-width, initial-scale=1.0">
//       <title>${design.company_name} - ${design.position}</title>
      
//       <!-- Preload preview image for instant display -->
//       ${previewImageUrl ? `<link rel="preload" href="${previewImageUrl}" as="image">` : ''}
      
//       <style>
//         * {
//           margin: 0;
//           padding: 0;
//           box-sizing: border-box;
//         }
//         body {
//           background: #f5f5f5;
//           min-height: 100vh;
//           display: flex;
//           flex-direction: column;
//           overflow-x: hidden;
//           font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
//         }
//         .header {
//           background: white;
//           padding: 24px 40px;
//           box-shadow: 0 1px 3px rgba(0,0,0,0.08);
//           position: sticky;
//           top: 0;
//           z-index: 100;
//         }
//         .header h1 {
//           color: #1a1a1a;
//           font-size: 20px;
//           margin-bottom: 6px;
//           font-weight: 600;
//         }
//         .header p {
//           color: #666;
//           font-size: 13px;
//         }
//         .badge {
//           display: inline-block;
//           padding: 4px 8px;
//           border-radius: 4px;
//           font-size: 12px;
//           font-weight: 600;
//           text-transform: uppercase;
//           margin-left: 8px;
//         }
//         .badge.pending { background: #FFF4E6; color: #F59E0B; }
//         .badge.approved { background: #D1FAE5; color: #059669; }
//         .badge.rejected { background: #FEE2E2; color: #DC2626; }
        
//         .container {
//           flex: 1;
//           display: flex;
//           justify-content: center;
//           align-items: center;
//           padding: 20px;
//           position: relative;
//         }
        
//         .design-wrapper {
//           width: 100%;
//           max-width: 1400px;
//           height: 85vh;
//           border-radius: 8px;
//           box-shadow: 0 2px 8px rgba(0,0,0,0.1);
//           background: white;
//           position: relative;
//           border: 1px solid #e5e5e5;
//           overflow: hidden;
//         }
        
//         /* Preview Image (loads instantly) */
//         .preview-container {
//           width: 100%;
//           height: 100%;
//           position: relative;
//           display: flex;
//           align-items: center;
//           justify-content: center;
//           background: #f9fafb;
//           cursor: pointer;
//           transition: transform 0.2s ease;
//         }
        
//         .preview-container:hover {
//           transform: scale(1.01);
//         }
        
//         .preview-image {
//           max-width: 100%;
//           max-height: 100%;
//           object-fit: contain;
//           display: block;
//         }
        
//         .preview-overlay {
//           position: absolute;
//           top: 0;
//           left: 0;
//           right: 0;
//           bottom: 0;
//           background: rgba(0, 0, 0, 0.5);
//           display: flex;
//           flex-direction: column;
//           align-items: center;
//           justify-content: center;
//           opacity: 0;
//           transition: opacity 0.3s ease;
//           color: white;
//         }
        
//         .preview-container:hover .preview-overlay {
//           opacity: 1;
//         }
        
//         .play-icon {
//           font-size: 64px;
//           margin-bottom: 16px;
//         }
        
//         .preview-text {
//           font-size: 18px;
//           font-weight: 600;
//         }
        
//         /* Full View Iframe (loads on demand) */
//         .iframe-container {
//           width: 100%;
//           height: 100%;
//           display: none;
//           position: relative;
//         }
        
//         .iframe-container.active {
//           display: block;
//         }
        
//         .design-frame {
//           width: 100%;
//           height: 100%;
//           border: none;
//         }
        
//         .loading-overlay {
//           position: absolute;
//           top: 0;
//           left: 0;
//           right: 0;
//           bottom: 0;
//           background: white;
//           display: flex;
//           flex-direction: column;
//           align-items: center;
//           justify-content: center;
//           z-index: 10;
//         }
        
//         .loading-overlay.hidden {
//           display: none;
//         }
        
//         .spinner {
//           width: 48px;
//           height: 48px;
//           border: 4px solid #f3f3f3;
//           border-top: 4px solid #1DBC79;
//           border-radius: 50%;
//           animation: spin 1s linear infinite;
//         }
        
//         @keyframes spin {
//           0% { transform: rotate(0deg); }
//           100% { transform: rotate(360deg); }
//         }
        
//         .loading-text {
//           margin-top: 16px;
//           color: #666;
//           font-size: 14px;
//         }
        
//         /* Action Buttons */
//         .action-buttons {
//           position: fixed;
//           bottom: 30px;
//           right: 30px;
//           display: flex;
//           flex-direction: column;
//           gap: 12px;
//           z-index: 1000;
//         }
        
//         .btn {
//           padding: 12px 24px;
//           border-radius: 6px;
//           font-size: 14px;
//           font-weight: 600;
//           cursor: pointer;
//           border: none;
//           box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
//           transition: all 0.2s ease;
//           display: inline-flex;
//           align-items: center;
//           gap: 8px;
//           text-decoration: none;
//         }
        
//         .btn:hover {
//           transform: translateY(-1px);
//           box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
//         }
        
//         .btn-primary {
//           background: #1DBC79;
//           color: white;
//         }
        
//         .btn-primary:hover {
//           background: #18a865;
//         }
        
//         .btn-secondary {
//           background: #4A90E2;
//           color: white;
//         }
        
//         .btn-secondary:hover {
//           background: #3a7bc8;
//         }
        
//         .btn-back {
//           background: #6B7280;
//           color: white;
//           display: none;
//         }
        
//         .btn-back.visible {
//           display: inline-flex;
//         }
        
//         .btn-back:hover {
//           background: #4B5563;
//         }
        
//         .copied {
//           position: fixed;
//           bottom: 170px;
//           right: 30px;
//           background: #1DBC79;
//           color: white;
//           padding: 12px 24px;
//           border-radius: 6px;
//           font-weight: 600;
//           opacity: 0;
//           transition: opacity 0.3s ease;
//           pointer-events: none;
//           box-shadow: 0 2px 8px rgba(29, 188, 121, 0.3);
//           z-index: 1000;
//         }
        
//         .copied.show {
//           opacity: 1;
//         }
        
//         /* Responsive */
//         @media (max-width: 768px) {
//           .header {
//             padding: 16px 20px;
//           }
//           .header h1 {
//             font-size: 16px;
//           }
//           .action-buttons {
//             right: 20px;
//             bottom: 20px;
//           }
//           .btn {
//             padding: 10px 20px;
//             font-size: 13px;
//           }
//         }
//       </style>
//     </head>
//     <body>
//       <div class="header">
//         <h1>
//           ${design.company_name} - ${design.position}
//           <span class="badge ${design.status}">${design.status}</span>
//         </h1>
//         <p>Design Submission • ${design.design_type.toUpperCase()} • Submitted ${new Date(design.created_at).toLocaleDateString()}</p>
//       </div>
      
//       <div class="container">
//         <div class="design-wrapper">
//           <!-- Preview Image (loads instantly) -->
//           <div class="preview-container" id="previewContainer" onclick="loadFullView()">
//             ${previewImageUrl ? `
//               <img src="${previewImageUrl}" alt="Design Preview" class="preview-image">
//               <div class="preview-overlay">
//                 <div class="play-icon">▶</div>
//                 <div class="preview-text">Click to view full design</div>
//               </div>
//             ` : `
//               <div class="preview-overlay" style="opacity: 1; background: rgba(0,0,0,0.1);">
//                 <div class="preview-text" style="color: #666;">Click to load design</div>
//               </div>
//             `}
//           </div>
          
//           <!-- Full View Iframe (loads on demand) -->
//           <div class="iframe-container" id="iframeContainer">
//             <div class="loading-overlay" id="loadingOverlay">
//               <div class="spinner"></div>
//               <div class="loading-text">Loading full design...</div>
//             </div>
//             <iframe 
//               id="designFrame"
//               class="design-frame"
//               data-src="${fullViewUrl}"
//               ${design.design_type === 'figma' ? 'sandbox="allow-same-origin allow-scripts allow-popups"' : ''}
//             ></iframe>
//           </div>
//         </div>
//       </div>

//       <div class="action-buttons">
//         <button class="btn btn-back" id="backBtn" onclick="showPreview()">
//           ← Back to Preview
//         </button>
        
  
        
//         <button class="btn btn-primary" onclick="copyLink()">
//           📋 Copy Link
//         </button>
//       </div>

//       <div class="copied" id="copiedMsg">
//         ✓ Link copied!
//       </div>

//       <script>
//         let isFullViewLoaded = false;
        
//         const previewContainer = document.getElementById('previewContainer');
//         const iframeContainer = document.getElementById('iframeContainer');
//         const designFrame = document.getElementById('designFrame');
//         const loadingOverlay = document.getElementById('loadingOverlay');
//         const backBtn = document.getElementById('backBtn');
        
//         function loadFullView() {
//           // Hide preview, show iframe
//           previewContainer.style.display = 'none';
//           iframeContainer.classList.add('active');
//           backBtn.classList.add('visible');
          
//           if (!isFullViewLoaded) {
//             // Load iframe for the first time
//             const src = designFrame.getAttribute('data-src');
//             designFrame.src = src;
//             isFullViewLoaded = true;
            
//             // Hide loading overlay after timeout
//             setTimeout(() => {
//               loadingOverlay.classList.add('hidden');
//             }, 3000);
            
//             designFrame.onload = function() {
//               loadingOverlay.classList.add('hidden');
//             };
//           } else {
//             // Already loaded, just hide loading
//             loadingOverlay.classList.add('hidden');
//           }
//         }
        
//         function showPreview() {
//           previewContainer.style.display = 'flex';
//           iframeContainer.classList.remove('active');
//           backBtn.classList.remove('visible');
//         }
        
//         function copyLink() {
//           const link = window.location.href;
//           navigator.clipboard.writeText(link).then(() => {
//             const msg = document.getElementById('copiedMsg');
//             msg.classList.add('show');
//             setTimeout(() => {
//               msg.classList.remove('show');
//             }, 2000);
//           }).catch(err => {
//             console.error('Failed to copy:', err);
//             alert('Failed to copy link');
//           });
//         }
//       </script>
//     </body>
//     </html>
//     `;

//     res.send(html);

//   } catch (err) {
//     console.error("Server error:", err);
//     res.status(500).json({ 
//       error: "Server error occurred",
//       details: err.message 
//     });
//   }
// });

// export default router;
import express from "express";
import { supabase_connect } from "../supabase/set-up.js";
import cookieParser from "cookie-parser";

const router = express.Router();
router.use(cookieParser());

// Get preview by unique ID
router.get('/:uniqueId', async (req, res) => {
  try {
    const { uniqueId } = req.params;

    if (!uniqueId) {
      return res.status(400).json({ error: "Missing unique ID" });
    }

    // Fetch design from database
    const { data: design, error } = await supabase_connect
      .from("design_submissions")
      .select("*")
      .eq('unique_id', uniqueId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: "Design not found" });
      }
      console.error("Fetch error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    if (!design) {
      return res.status(404).json({ error: "Design not found" });
    }

    // ===== VIEW TRACKING LOGIC =====
    const viewCookieName = `viewed_${uniqueId}`;
    const hasViewedBefore = req.cookies[viewCookieName];

    if (!hasViewedBefore) {
      // First time viewing this design - track it!
      const currentViews = design.total_views || 0;
      
      // IMPORTANT: Change status from 'pending' to 'viewed' on first view
      const newStatus = design.status === 'pending' ? 'viewed' : design.status;

      // Update view count, timestamp, and status
      const { error: updateError } = await supabase_connect
        .from("design_submissions")
        .update({ 
          total_views: currentViews + 1,
          last_viewed_at: new Date().toISOString(),
          status: newStatus // Update status to 'viewed'
        })
        .eq('id', design.id);

      if (updateError) {
        console.error("View update error:", updateError);
      } else {
        console.log(`✅ View tracked for ${uniqueId}. Status: ${design.status} → ${newStatus}, Views: ${currentViews} → ${currentViews + 1}`);
      }

      // Set cookie to expire in 24 hours
      res.cookie(viewCookieName, 'true', {
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: true
      });

    } else {
      console.log(` Duplicate view prevented for ${uniqueId} (cookie exists)`);
    }

    // Determine URLs
    let previewImageUrl = design.preview_thumbnail;
    let fullViewUrl = design.embed_url;
 if (design.design_type === 'pdf') {
  // Use signed URL for private buckets (valid for 1 hour)
  const { data, error: signedUrlError } = await supabase_connect.storage
    .from('design_files')
    .createSignedUrl(design.pdf_file_path, 3600); // 3600 seconds = 1 hour
  
  if (signedUrlError) {
    console.error("Signed URL error:", signedUrlError);
    return res.status(500).json({ error: "Failed to generate PDF URL" });
  }
  
  fullViewUrl = data.signedUrl;
}

    // Return HTML (same as before)
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${design.company_name} - ${design.position}</title>
      
      ${previewImageUrl ? `<link rel="preload" href="${previewImageUrl}" as="image">` : ''}
      
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          background: #f5f5f5;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          overflow-x: hidden;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        }
        .header {
          background: white;
          padding: 24px 40px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
          position: sticky;
          top: 0;
          z-index: 100;
        }
        .header h1 {
          color: #1a1a1a;
          font-size: 20px;
          margin-bottom: 6px;
          font-weight: 600;
        }
        .header p {
          color: #666;
          font-size: 13px;
        }
        .badge {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          margin-left: 8px;
        }
        .badge.pending { background: #FFF4E6; color: #F59E0B; }
        .badge.viewed { background: #DBEAFE; color: #2563EB; }
        .badge.approved { background: #D1FAE5; color: #059669; }
        .badge.rejected { background: #FEE2E2; color: #DC2626; }
        
        .container {
          flex: 1;
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 20px;
          position: relative;
        }
        
        .design-wrapper {
          width: 100%;
          max-width: 1400px;
          height: 85vh;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          background: white;
          position: relative;
          border: 1px solid #e5e5e5;
          overflow: hidden;
        }
        
        .preview-container {
          width: 100%;
          height: 100%;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #f9fafb;
          cursor: pointer;
          transition: transform 0.2s ease;
        }
        
        .preview-container:hover {
          transform: scale(1.01);
        }
        
        .preview-image {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
          display: block;
        }
        
        .preview-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: opacity 0.3s ease;
          color: white;
        }
        
        .preview-container:hover .preview-overlay {
          opacity: 1;
        }
        
        .play-icon {
          font-size: 64px;
          margin-bottom: 16px;
        }
        
        .preview-text {
          font-size: 18px;
          font-weight: 600;
        }
        
        .iframe-container {
          width: 100%;
          height: 100%;
          display: none;
          position: relative;
        }
        
        .iframe-container.active {
          display: block;
        }
        
        .design-frame {
          width: 100%;
          height: 100%;
          border: none;
        }
        
        .loading-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: white;
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
          width: 48px;
          height: 48px;
          border: 4px solid #f3f3f3;
          border-top: 4px solid #1DBC79;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        .loading-text {
          margin-top: 16px;
          color: #666;
          font-size: 14px;
        }
        
        .action-buttons {
          position: fixed;
          bottom: 30px;
          right: 30px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          z-index: 1000;
        }
        
        .btn {
          padding: 12px 24px;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          text-decoration: none;
        }
        
        .btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }
        
        .btn-primary {
          background: #1DBC79;
          color: white;
        }
        
        .btn-primary:hover {
          background: #18a865;
        }
        
        .btn-back {
          background: #6B7280;
          color: white;
          display: none;
        }
        
        .btn-back.visible {
          display: inline-flex;
        }
        
        .btn-back:hover {
          background: #4B5563;
        }
        
        .copied {
          position: fixed;
          bottom: 170px;
          right: 30px;
          background: #1DBC79;
          color: white;
          padding: 12px 24px;
          border-radius: 6px;
          font-weight: 600;
          opacity: 0;
          transition: opacity 0.3s ease;
          pointer-events: none;
          box-shadow: 0 2px 8px rgba(29, 188, 121, 0.3);
          z-index: 1000;
        }
        
        .copied.show {
          opacity: 1;
        }
        
        @media (max-width: 768px) {
          .header {
            padding: 16px 20px;
          }
          .header h1 {
            font-size: 16px;
          }
          .action-buttons {
            right: 20px;
            bottom: 20px;
          }
          .btn {
            padding: 10px 20px;
            font-size: 13px;
          }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>
          ${design.company_name} - ${design.position}
          <span class="badge ${design.status}">${design.status}</span>
        </h1>
        <p>Design Submission • ${design.design_type.toUpperCase()} • Submitted ${new Date(design.created_at).toLocaleDateString()}</p>
      </div>
      
      <div class="container">
        <div class="design-wrapper">
          <div class="preview-container" id="previewContainer" onclick="loadFullView()">
            ${previewImageUrl ? `
              <img src="${previewImageUrl}" alt="Design Preview" class="preview-image">
              <div class="preview-overlay">
                <div class="play-icon">▶</div>
                <div class="preview-text">Click to view full design</div>
              </div>
            ` : `
              <div class="preview-overlay" style="opacity: 1; background: rgba(0,0,0,0.1);">
                <div class="preview-text" style="color: #666;">Click to load design</div>
              </div>
            `}
          </div>
          
          <div class="iframe-container" id="iframeContainer">
            <div class="loading-overlay" id="loadingOverlay">
              <div class="spinner"></div>
              <div class="loading-text">Loading full design...</div>
            </div>
            <iframe 
              id="designFrame"
              class="design-frame"
              data-src="${fullViewUrl}"
              ${design.design_type === 'figma' ? 'sandbox="allow-same-origin allow-scripts allow-popups"' : ''}
            ></iframe>
          </div>
        </div>
      </div>

      <div class="action-buttons">
        <button class="btn btn-back" id="backBtn" onclick="showPreview()">
          ← Back to Preview
        </button>
        
        <button class="btn btn-primary" onclick="copyLink()">
          Copy Link
        </button>
      </div>

      <div class="copied" id="copiedMsg">
        ✓ Link copied!
      </div>

      <script>
        let isFullViewLoaded = false;
        
        const previewContainer = document.getElementById('previewContainer');
        const iframeContainer = document.getElementById('iframeContainer');
        const designFrame = document.getElementById('designFrame');
        const loadingOverlay = document.getElementById('loadingOverlay');
        const backBtn = document.getElementById('backBtn');
        
        function loadFullView() {
          previewContainer.style.display = 'none';
          iframeContainer.classList.add('active');
          backBtn.classList.add('visible');
          
          if (!isFullViewLoaded) {
            const src = designFrame.getAttribute('data-src');
            designFrame.src = src;
            isFullViewLoaded = true;
            
            setTimeout(() => {
              loadingOverlay.classList.add('hidden');
            }, 3000);
            
            designFrame.onload = function() {
              loadingOverlay.classList.add('hidden');
            };
          } else {
            loadingOverlay.classList.add('hidden');
          }
        }
        
        function showPreview() {
          previewContainer.style.display = 'flex';
          iframeContainer.classList.remove('active');
          backBtn.classList.remove('visible');
        }
        
        function copyLink() {
          const link = window.location.href;
          navigator.clipboard.writeText(link).then(() => {
            const msg = document.getElementById('copiedMsg');
            msg.classList.add('show');
            setTimeout(() => {
              msg.classList.remove('show');
            }, 2000);
          }).catch(err => {
            console.error('Failed to copy:', err);
            alert('Failed to copy link');
          });
        }
      </script>
    </body>
    </html>
    `;

    res.send(html);

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ 
      error: "Server error occurred",
      details: err.message 
    });
  }
});

export default router;