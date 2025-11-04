// import express from "express";
// import { supabase_connect } from "../supabase/set-up.js";
// import cookieParser from "cookie-parser";

// const router = express.Router();
// router.use(cookieParser());

// // Get preview by unique ID with layers
// router.get('/:uniqueId', async (req, res) => {
//   try {
//     const { uniqueId } = req.params;

//     if (!uniqueId) {
//       return res.status(400).json({ error: "Missing unique ID" });
//     }

//     // Fetch design from database
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

//     // Fetch layers if Figma design (ordered by layer_order)
//     let layers = [];
//     if (design.design_type === 'figma') {
//       const { data: layersData, error: layersError } = await supabase_connect
//         .from("design_layers")
//         .select("*")
//         .eq('submission_id', design.id)
//         .order('layer_order', { ascending: true });

//       if (!layersError && layersData) {
//         // For each layer, fetch the preview image from storage
//         // Path structure: userId/submissionId/layerName_layerOrder.png
//         for (let layer of layersData) {
//           const sanitizedLayerName = layer.layer_name.replace(/[^a-zA-Z0-9]/g, '_');
//           const imagePath = `${design.user_id}/${design.id}/${sanitizedLayerName}_${layer.layer_order}.png`;
          
//           // Try to get signed URL for this layer
//           const { data: signedData, error: signedError } = await supabase_connect.storage
//             .from('design_previews')
//             .createSignedUrl(imagePath, 3600);
          
//           if (!signedError && signedData) {
//             layer.layer_preview_url = signedData.signedUrl;
//           } else {
//             console.log(`⚠️ Could not fetch preview for layer: ${imagePath}`);
//             layer.layer_preview_url = null;
//           }
//         }
        
//         layers = layersData;
//       }
//     }

//     // Calculate loading time based on layers count
//     const loadingDuration = layers.length > 8 ? 19000 : (layers.length > 0 ? 10000 : 15000);

//     // ===== VIEW TRACKING LOGIC =====
//     const viewCookieName = `viewed_${uniqueId}`;
//     const hasViewedBefore = req.cookies[viewCookieName];

//     if (!hasViewedBefore) {
//       const currentViews = design.total_views || 0;
//       const newStatus = design.status === 'pending' ? 'viewed' : design.status;

//       const { error: updateError } = await supabase_connect
//         .from("design_submissions")
//         .update({ 
//           total_views: currentViews + 1,
//           last_viewed_at: new Date().toISOString(),
//           status: newStatus
//         })
//         .eq('id', design.id);

//       if (updateError) {
//         console.error("View update error:", updateError);
//       } else {
//         console.log(`📊 View tracked for ${uniqueId}. Status: ${design.status} → ${newStatus}, Views: ${currentViews} → ${currentViews + 1}`);
//       }

//       res.cookie(viewCookieName, 'true', {
//         maxAge: 24 * 60 * 60 * 1000,
//         httpOnly: true
//       });

//     } else {
//       console.log(`🔄 Duplicate view prevented for ${uniqueId} (cookie exists)`);
//     }

//     // Generate signed URL for main preview thumbnail (used for PDF or default)
//     let previewImageUrl = null;
//     if (design.preview_thumbnail) {
//       const { data: signedData, error: signedError } = await supabase_connect.storage
//         .from('design_previews')
//         .createSignedUrl(design.preview_thumbnail, 3600);
      
//       if (!signedError && signedData) {
//         previewImageUrl = signedData.signedUrl;
//       }
//     }

//     // Determine full view URL for PDF
//     let fullViewUrl = null;
//     if (design.design_type === 'pdf') {
//       const { data, error: signedUrlError } = await supabase_connect.storage
//         .from('design_files')
//         .createSignedUrl(design.pdf_file_path, 3600);
      
//       if (signedUrlError) {
//         console.error("Signed URL error:", signedUrlError);
//         return res.status(500).json({ error: "Failed to generate PDF URL" });
//       }
      
//       fullViewUrl = data.signedUrl;
//     }

//     // Get default layer preview URL (layer 0) for Figma designs
//     let defaultLayerUrl = null;
//     if (design.design_type === 'figma' && layers.length > 0 && layers[0].layer_preview_url) {
//       defaultLayerUrl = layers[0].layer_preview_url;
//     }

//     // Serialize layers data for JavaScript
//     const layersJSON = JSON.stringify(layers);

//     // ===== RENDER HTML =====
// const html = `
// <!DOCTYPE html>
// <html lang="en">
// <head>
//   <meta charset="UTF-8">
//   <meta name="viewport" content="width=device-width, initial-scale=1.0">
//   <title>${design.position} - ${design.company_name}</title>
  
//   <style>
//     * { margin: 0; padding: 0; box-sizing: border-box; }
//     body { background: #FFFFFF; min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111827; }

//     /* Loading Screen */
//     .loading-screen { position: fixed; inset: 0; background: #FFFFFF; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 9999; transition: opacity 0.5s ease; }
//     .loading-screen.fade-out { opacity: 0; pointer-events: none; }
//     .loading-logo { font-size: 28px; font-weight: 700; color: #111827; margin-bottom: 24px; letter-spacing: -0.5px; }
//     .loading-spinner { width: 48px; height: 48px; border: 4px solid #E5E7EB; border-top: 4px solid #3B82F6; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 16px; }
//     .loading-text { color: #6B7280; font-size: 15px; font-weight: 500; margin-bottom: 8px; }
//     .loading-subtext { color: #9CA3AF; font-size: 13px; }
//     @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

//     /* Main Content - Hidden initially */
//     .main-content { opacity: 0; transition: opacity 0.5s ease; }
//     .main-content.visible { opacity: 1; }

//     /* Navbar */
//     .navbar { background: #FFFFFF; padding: 20px 32px; border-bottom: 1px solid #E5E7EB; }
//     .nav-content { max-width: 1400px; margin: 0 auto; }
//     .nav-title { font-size: 22px; font-weight: 600; color: #111827; margin-bottom: 6px; }
//     .nav-meta { font-size: 14px; color: #6B7280; }

//     /* Page container */
//     .page-container { max-width: 1400px; margin: 0 auto; padding: 0 32px 24px 32px; display: grid; grid-template-columns: 1fr 300px; gap: 24px; align-items: start; }

//     /* Content area */
//     .content-area { background: #F9FAFB; border-radius: 0; padding: 24px 20px 20px 20px; min-height: 600px; position: relative; }
    
//     // .page-dropdown { width: 240px; padding: 12px 14px; border: 1px solid #E5E7EB; border-radius: 10px; background: white; font-size: 14px; font-weight: 500; color: #333333; cursor: pointer; appearance: none; background-image: url("data:image/svg+xml,%3Csvg width='10' height='10' viewBox='0 0 10 10' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M2 3.5L5 6.5L8 3.5' stroke='%23999999' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 14px center; padding-right: 38px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); transition: all 0.2s ease; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
//     // .page-dropdown:hover { border-color: #D1D5DB; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
//     // .page-dropdown:focus { outline: none; border-color: #3B82F6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
//     // .page-dropdown:disabled { opacity: 0.5; cursor: not-allowed; }
//     // .page-dropdown option { padding: 10px 14px; font-weight: 400; color: #333333; background: white; }
//     // .page-dropdown option:hover { background: #F5F5F5; }
//     // .page-dropdown option:checked { background: #F0F4FF; color: #3B82F6; font-weight: 500; }
//   .page-dropdown { width: 240px; padding: 10px 12px; border: 1px solid #E5E7EB; border-radius: 8px; background: white; font-size: 14px; font-weight: 500; color: #333333; cursor: pointer; appearance: none; background-image: url("data:image/svg+xml,%3Csvg width='10' height='10' viewBox='0 0 10 10' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M2 3.5L5 6.5L8 3.5' stroke='%23999999' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 36px; box-shadow: 0 4px 10px rgba(0,0,0,0.08); transition: all 0.2s ease; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
//     .page-dropdown:hover { border-color: #D1D5DB; box-shadow: 0 4px 12px rgba(0,0,0,0.12); background: #FAFAFA; }
//     .page-dropdown:focus { outline: none; border-color: #3B82F6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
//     .page-dropdown:disabled { opacity: 0.5; cursor: not-allowed; }
    
//     /* Dropdown list styling (the expanded menu) */
//     select.page-dropdown:focus { border-radius: 8px 8px 0 0; }
//     select.page-dropdown option:first-child { border-radius: 8px 8px 0 0; }
//     select.page-dropdown option:last-child { border-radius: 0 0 8px 8px; }
//     .page-dropdown option { padding: 10px 12px; font-weight: 400; color: #333333; background: white; border-radius: 6px; }
//     .page-dropdown option:hover { background: #F5F5F5; }
//     .page-dropdown option:checked { background: #F0F4FF; color: #3B82F6; font-weight: 500; }

//     .preview-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 12px; }
//     .preview-controls { display: flex; gap: 8px; align-items: center; }
    
//     .expand-btn { width: 36px; height: 36px; border-radius: 10px; border: 1px solid #E5E7EB; background: white; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; }
//     .expand-btn:hover { background: #F9FAFB; border-color: #D1D5DB; }
    
//     .preview-area { background: #FFFFFF; border-radius: 20px; overflow: hidden; min-height: 600px; position: relative; display: flex; align-items: center; justify-content: center; }
    
//     /* Screenshot View */
//     .screenshot-container { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; position: relative; }
//     .preview-image { width: 100%; height: 100%; object-fit: contain; display: block; max-height: 700px; transition: opacity 0.3s ease; }
//     .preview-image.loading { opacity: 0; }
    
//     /* Layer loading overlay */
//     .layer-loading-overlay { position: absolute; inset: 0; background: rgba(255,255,255,0.9); display: none; align-items: center; justify-content: center; z-index: 5; }
//     .layer-loading-overlay.show { display: flex; }
//     .mini-spinner { width: 32px; height: 32px; border: 3px solid #E5E7EB; border-top: 3px solid #3B82F6; border-radius: 50%; animation: spin 0.8s linear infinite; }
    
//     /* PDF Iframe View */
//     .iframe-container { width: 100%; height: 100%; position: relative; }
//     .design-frame { width: 100%; height: 650px; border: none; display: block; }

//     .loading-overlay { position: absolute; inset: 0; background: rgba(255,255,255,0.98); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 10; }
//     .loading-overlay.hidden { display: none; }
//     .spinner { width: 32px; height: 32px; border: 3px solid #E5E7EB; border-top: 3px solid #3B82F6; border-radius: 50%; animation: spin 0.8s linear infinite; }
//     .loading-text-small { margin-top: 12px; color: #6B7280; font-size: 14px; font-weight: 500; }

//     /* Info panels */
//     .info-column { display: flex; flex-direction: column; gap: 16px; padding-top: 24px; }
//     .info-panel.usage-terms { background: #FFFFFF; border-radius: 10px; overflow: hidden; border: 1px solid #FDE68A; }
//     .info-panel.usage-terms h3 { font-size: 16px; font-weight: 600; color: #92400E; background: #FFFBEB; padding: 14px 16px; margin: 0; border-bottom: 1px solid #FDE68A; }
//     .info-panel.usage-terms ul { margin-left: 18px; color: #374151; font-size: 13px; line-height: 1.7; padding: 16px; }
//     .info-panel.usage-terms li { margin-bottom: 6px; }
    
//     .info-panel.documentation { background: #FFFFFF; border-radius: 10px; overflow: hidden; border: 1px solid #BFDBFE; }
//     .info-panel.documentation h3 { font-size: 16px; font-weight: 600; color: #1E40AF; background: #EFF6FF; padding: 14px 16px; margin: 0; border-bottom: 1px solid #BFDBFE; }
//     .info-panel.documentation ul { margin-left: 18px; color: #374151; font-size: 13px; line-height: 1.7; padding: 16px; }
//     .info-panel.documentation li { margin-bottom: 6px; }

//     /* Responsive */
//     @media (max-width: 1100px) {
//       .page-container { grid-template-columns: 1fr; padding: 20px; gap: 20px; }
//       .design-frame { height: 500px; }
//       .info-column { flex-direction: row; gap: 16px; }
//       .info-panel { flex: 1; }
//     }

//     @media (max-width: 768px) {
//       .page-container { padding: 16px; }
//       .navbar { padding: 16px 20px; }
//       .nav-title { font-size: 18px; }
//       .nav-meta { font-size: 13px; }
//       .preview-header { flex-direction: column; align-items: flex-start; }
//       .preview-controls { width: 100%; justify-content: flex-end; }
//       .info-column { flex-direction: column; }
//       .design-frame { height: 450px; }
//       .loading-logo { font-size: 24px; }
//     }
//   </style>
// </head>
// <body>
//   <!-- Loading Screen -->
//   <div class="loading-screen" id="loadingScreen">
//     <div class="loading-logo">The BYND</div>
//     <div class="loading-spinner"></div>
//     <div class="loading-text">Loading design submission...</div>
//     <div class="loading-subtext">Preparing ${layers.length > 0 ? layers.length + ' pages' : 'your preview'}</div>
//   </div>

//   <!-- Main Content -->
//   <div class="main-content" id="mainContent">
//     <div class="navbar">
//       <div class="nav-content">
//         <div class="nav-title">${design.position}</div>
//         <div class="nav-meta">${design.company_name} • Submitted on ${new Date(design.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}</div>
//       </div>
//     </div>

//     <div class="page-container">
//       <div class="content-area">
//         <div class="preview-header">
//           ${design.design_type === 'figma' && layers.length > 0 ? `
//           <select class="page-dropdown" id="pageSelect" onchange="switchPage(this.value)">
//             ${layers.map((layer, idx) => `<option value="${idx}" ${idx === 0 ? 'selected' : ''}>Page: ${layer.layer_name}</option>`).join('')}
//           </select>
//           ` : '<div></div>'}
          
//           <div class="preview-controls">
//             <button class="expand-btn" onclick="toggleFullscreen()" title="Expand to fullscreen">
//               <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
//                 <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
//               </svg>
//             </button>
//           </div>
//         </div>

//         <div class="preview-area" id="previewArea">
//           ${design.design_type === 'figma' ? `
//           <!-- FIGMA: Screenshot preview (default to layer 0) -->
//           <div class="screenshot-container" id="screenshotContainer">
//             <div class="layer-loading-overlay" id="layerLoadingOverlay">
//               <div class="mini-spinner"></div>
//             </div>
//             ${defaultLayerUrl ? `<img src="${defaultLayerUrl}" alt="Design Preview" class="preview-image loading" id="previewImage">` : `<div style="color:#9CA3AF;font-size:14px;">Loading preview...</div>`}
//           </div>
//           ` : `
//           <!-- PDF: Iframe view -->
//           <div class="iframe-container" id="iframeContainer">
//             <div class="loading-overlay" id="loadingOverlay">
//               <div class="spinner"></div>
//               <div class="loading-text-small">Loading PDF...</div>
//             </div>
//             <iframe id="designFrame" class="design-frame" src="${fullViewUrl}"></iframe>
//           </div>
//           `}
//         </div>
//       </div>

//       <div class="info-column">
//         <div class="info-panel usage-terms">
//           <h3>Usage Terms</h3>
//           <ul>
//             <li>This design is shared for evaluation purposes only.</li>
//             <li>The content is the intellectual property of the applicant.</li>
//             <li>Redistribution, duplication, or reuse is discouraged and may be subject to follow-up.</li>
//           </ul>
//         </div>

//         <div class="info-panel documentation">
//           <h3>Documentation Notice</h3>
//           <ul>
//             <li>This submission is documented by The BYND with activity logs, timestamps, and owner details.</li>
//             <li>Viewing this assignment logs your access and supports a fair review process.</li>
//             <li>The BYND helps ensure the designer receives credit for their work through transparent documentation.</li>
//           </ul>
//         </div>
//       </div>
//     </div>
//   </div>

//   <script>
//     const layers = ${layersJSON};
//     const designType = '${design.design_type}';
//     const loadingDuration = ${loadingDuration};
//     let currentLayerIndex = 0;
//     let isLayerSwitching = false;
//     const preloadedImages = new Map(); // Cache for preloaded images

//     const loadingScreen = document.getElementById('loadingScreen');
//     const mainContent = document.getElementById('mainContent');
//     const previewArea = document.getElementById('previewArea');
//     const screenshotContainer = document.getElementById('screenshotContainer');
//     const previewImage = document.getElementById('previewImage');
//     const layerLoadingOverlay = document.getElementById('layerLoadingOverlay');
//     const iframeContainer = document.getElementById('iframeContainer');
//     const designFrame = document.getElementById('designFrame');
//     const loadingOverlay = document.getElementById('loadingOverlay');
//     const pageSelect = document.getElementById('pageSelect');

//     // Preload all layer images on page load for smooth switching
//     function preloadAllLayers() {
//       if (designType !== 'figma' || layers.length === 0) return;
      
//       console.log('🔄 Preloading all layers...');
      
//       layers.forEach((layer, idx) => {
//         if (layer.layer_preview_url) {
//           const img = new Image();
//           img.onload = () => {
//             preloadedImages.set(idx, img);
//             console.log(\`✅ Preloaded layer \${idx}: \${layer.layer_name}\`);
//           };
//           img.onerror = () => {
//             console.error(\`❌ Failed to preload layer \${idx}: \${layer.layer_name}\`);
//           };
//           img.src = layer.layer_preview_url;
//         }
//       });
//     }

//     // Hide loading screen and show content after specified duration
//     setTimeout(() => {
//       loadingScreen.classList.add('fade-out');
//       mainContent.classList.add('visible');
      
//       // Remove loading screen from DOM after fade out
//       setTimeout(() => {
//         loadingScreen.style.display = 'none';
//       }, 500);

//       // Start preloading all layers after main content is visible
//       if (designType === 'figma') {
//         preloadAllLayers();
        
//         // Make sure first image is visible
//         if (previewImage) {
//           previewImage.onload = () => {
//             previewImage.classList.remove('loading');
//           };
//           // Fallback in case onload doesn't fire
//           setTimeout(() => {
//             if (previewImage.classList.contains('loading')) {
//               previewImage.classList.remove('loading');
//             }
//           }, 1000);
//         }
//       }
//     }, loadingDuration);

//     // For PDF: Hide loading overlay after iframe loads
//     if (designType === 'pdf' && designFrame && loadingOverlay) {
//       designFrame.onload = () => {
//         loadingOverlay.classList.add('hidden');
//       };
//       setTimeout(() => {
//         loadingOverlay.classList.add('hidden');
//       }, 3000);
//     }

//     // For Figma: Layer switching with proper preloading
//     function switchLayer(layerIndex) {
//       if (isLayerSwitching || layerIndex === currentLayerIndex || layers.length === 0) return;
      
//       const layer = layers[layerIndex];
//       if (!layer || !layer.layer_preview_url || !previewImage) return;

//       isLayerSwitching = true;

//       // Disable dropdown during switch
//       if (pageSelect) pageSelect.disabled = true;

//       // Show loading overlay
//       if (layerLoadingOverlay) {
//         layerLoadingOverlay.classList.add('show');
//       }

//       // Hide current image
//       previewImage.classList.add('loading');

//       // Check if image is already preloaded
//       if (preloadedImages.has(layerIndex)) {
//         // Use cached image
//         const cachedImg = preloadedImages.get(layerIndex);
//         previewImage.src = cachedImg.src;
        
//         // Give browser time to render
//         setTimeout(() => {
//           previewImage.classList.remove('loading');
//           if (layerLoadingOverlay) {
//             layerLoadingOverlay.classList.remove('show');
//           }
//           if (pageSelect) pageSelect.disabled = false;
//           isLayerSwitching = false;
//           currentLayerIndex = layerIndex;
//           console.log(\`✅ Switched to layer \${layerIndex} (from cache)\`);
//         }, 100);
//       } else {
//         // Load image if not cached
//         const img = new Image();
        
//         img.onload = () => {
//           previewImage.src = img.src;
//           preloadedImages.set(layerIndex, img);
          
//           // Wait for browser to render the image
//           requestAnimationFrame(() => {
//             setTimeout(() => {
//               previewImage.classList.remove('loading');
//               if (layerLoadingOverlay) {
//                 layerLoadingOverlay.classList.remove('show');
//               }
//               if (pageSelect) pageSelect.disabled = false;
//               isLayerSwitching = false;
//               currentLayerIndex = layerIndex;
//               console.log(\`✅ Switched to layer \${layerIndex} (loaded)\`);
//             }, 100);
//           });
//         };

//         img.onerror = () => {
//           console.error(\`❌ Failed to load layer \${layerIndex}: \${layer.layer_name}\`);
//           previewImage.classList.remove('loading');
//           if (layerLoadingOverlay) {
//             layerLoadingOverlay.classList.remove('show');
//           }
//           if (pageSelect) pageSelect.disabled = false;
//           isLayerSwitching = false;
          
//           // Show error message
//           alert(\`Failed to load page: \${layer.layer_name}. Please try again.\`);
//         };

//         img.src = layer.layer_preview_url;
//       }
//     }

//     function switchPage(value) {
//       const idx = Number(value);
//       if (!isNaN(idx) && idx >= 0 && idx < layers.length) {
//         switchLayer(idx);
//       }
//     }

//     function toggleFullscreen() {
//       if (!document.fullscreenElement) {
//         previewArea.requestFullscreen().catch(err => console.error('Fullscreen error:', err));
//       } else {
//         document.exitFullscreen();
//       }
//     }

//     // Initialize: Make sure layer 0 is selected on load
//     if (designType === 'figma' && layers.length > 0 && pageSelect) {
//       pageSelect.value = '0';
//       currentLayerIndex = 0;
//     }

//     // Prevent page select changes while switching
//     if (pageSelect) {
//       pageSelect.addEventListener('mousedown', (e) => {
//         if (isLayerSwitching) {
//           e.preventDefault();
//         }
//       });
//     }
//   </script>
// </body>
// </html>
// `;

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

// Get preview by unique ID with layers
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

    // Fetch layers if Figma design (ordered by layer_order)
    let layers = [];
    if (design.design_type === 'figma') {
      const { data: layersData, error: layersError } = await supabase_connect
        .from("design_layers")
        .select("*")
        .eq('submission_id', design.id)
        .order('layer_order', { ascending: true });

      if (!layersError && layersData) {
        // For each layer, fetch the preview image from storage
        for (let layer of layersData) {
          const sanitizedLayerName = layer.layer_name.replace(/[^a-zA-Z0-9]/g, '_');
          const imagePath = `${design.user_id}/${design.id}/${sanitizedLayerName}_${layer.layer_order}.png`;
          
          const { data: signedData, error: signedError } = await supabase_connect.storage
            .from('design_previews')
            .createSignedUrl(imagePath, 3600);
          
          if (!signedError && signedData) {
            layer.layer_preview_url = signedData.signedUrl;
          } else {
            console.log(` Could not fetch preview for layer: ${imagePath}`);
            layer.layer_preview_url = null;
          }
        }
        
        layers = layersData;
      }
    }

    // Calculate loading time based on layers count
    const loadingDuration = layers.length > 8 ? 19000 : (layers.length > 0 ? 10000 : 15000);

    // ===== VIEW TRACKING LOGIC =====
    const viewCookieName = `viewed_${uniqueId}`;
    const hasViewedBefore = req.cookies[viewCookieName];

    if (!hasViewedBefore) {
      const currentViews = design.total_views || 0;
      const newStatus = design.status === 'pending' ? 'viewed' : design.status;

      const { error: updateError } = await supabase_connect
        .from("design_submissions")
        .update({ 
          total_views: currentViews + 1,
          last_viewed_at: new Date().toISOString(),
          status: newStatus
        })
        .eq('id', design.id);

      if (updateError) {
        console.error("View update error:", updateError);
      } else {
        console.log(`📊 View tracked for ${uniqueId}. Status: ${design.status} → ${newStatus}, Views: ${currentViews} → ${currentViews + 1}`);
      }

      res.cookie(viewCookieName, 'true', {
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true
      });

    } else {
      console.log(`🔄 Duplicate view prevented for ${uniqueId} (cookie exists)`);
    }

    // Generate signed URL for main preview thumbnail
    let previewImageUrl = null;
    if (design.preview_thumbnail) {
      const { data: signedData, error: signedError } = await supabase_connect.storage
        .from('design_previews')
        .createSignedUrl(design.preview_thumbnail, 3600);
      
      if (!signedError && signedData) {
        previewImageUrl = signedData.signedUrl;
      }
    }

    // Determine full view URL for PDF (with toolbar disabled)
    let fullViewUrl = null;
    if (design.design_type === 'pdf') {
      const { data, error: signedUrlError } = await supabase_connect.storage
        .from('design_files')
        .createSignedUrl(design.pdf_file_path, 3600);
      
      if (signedUrlError) {
        console.error("Signed URL error:", signedUrlError);
        return res.status(500).json({ error: "Failed to generate PDF URL" });
      }
      
      // Add parameters to hide toolbar
      fullViewUrl = data.signedUrl + '#toolbar=0&navpanes=0&scrollbar=0';
    }

    // Get default layer preview URL (layer 0) for Figma designs
    let defaultLayerUrl = null;
    if (design.design_type === 'figma' && layers.length > 0 && layers[0].layer_preview_url) {
      defaultLayerUrl = layers[0].layer_preview_url;
    }

    // Serialize layers data for JavaScript
    const layersJSON = JSON.stringify(layers);

    // ===== RENDER HTML =====
const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${design.position} - ${design.company_name}</title>
  
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #FFFFFF; min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111827; }

    /* Loading Screen */
    .loading-screen { position: fixed; inset: 0; background: #FFFFFF; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 9999; transition: opacity 0.5s ease; }
    .loading-screen.fade-out { opacity: 0; pointer-events: none; }
    .loading-logo { font-size: 28px; font-weight: 700; color: #111827; margin-bottom: 24px; letter-spacing: -0.5px; }
    .loading-spinner { width: 48px; height: 48px; border: 4px solid #E5E7EB; border-top: 4px solid #3B82F6; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 16px; }
    .loading-text { color: #6B7280; font-size: 15px; font-weight: 500; margin-bottom: 8px; }
    .loading-subtext { color: #9CA3AF; font-size: 13px; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

    /* Main Content - Hidden initially */
    .main-content { opacity: 0; transition: opacity 0.5s ease; }
    .main-content.visible { opacity: 1; }

    /* Navbar */
    .navbar { background: #FFFFFF; padding: 20px 32px; border-bottom: 1px solid #E5E7EB; }
    .nav-content { max-width: 1400px; margin: 0 auto; }
    .nav-title { font-size: 22px; font-weight: 600; color: #111827; margin-bottom: 6px; }
    .nav-meta { font-size: 14px; color: #6B7280; }

    /* Page container */
    .page-container { max-width: 1400px; margin: 0 auto; padding: 0 32px 24px 32px; display: grid; grid-template-columns: 1fr 300px; gap: 24px; align-items: start; }

    /* Content area */
    .content-area { background: #F9FAFB; border-radius: 0; padding: 24px 20px 20px 20px; min-height: 600px; position: relative; }
    
    /* Figma dropdown */
    .page-dropdown { width: 240px; padding: 10px 12px; border: 1px solid #E5E7EB; border-radius: 8px; background: white; font-size: 14px; font-weight: 500; color: #333333; cursor: pointer; appearance: none; background-image: url("data:image/svg+xml,%3Csvg width='10' height='10' viewBox='0 0 10 10' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M2 3.5L5 6.5L8 3.5' stroke='%23999999' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 36px; box-shadow: 0 4px 10px rgba(0,0,0,0.08); transition: all 0.2s ease; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .page-dropdown:hover { border-color: #D1D5DB; box-shadow: 0 4px 12px rgba(0,0,0,0.12); background: #FAFAFA; }
    .page-dropdown:focus { outline: none; border-color: #3B82F6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
    .page-dropdown:disabled { opacity: 0.5; cursor: not-allowed; }
    
    select.page-dropdown:focus { border-radius: 8px 8px 0 0; }
    select.page-dropdown option:first-child { border-radius: 8px 8px 0 0; }
    select.page-dropdown option:last-child { border-radius: 0 0 8px 8px; }
    .page-dropdown option { padding: 10px 12px; font-weight: 400; color: #333333; background: white; border-radius: 6px; }
    .page-dropdown option:hover { background: #F5F5F5; }
    .page-dropdown option:checked { background: #F0F4FF; color: #3B82F6; font-weight: 500; }

    .preview-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 12px; }
    .preview-controls { display: flex; gap: 8px; align-items: center; }
    
    .expand-btn { width: 36px; height: 36px; border-radius: 10px; border: 1px solid #E5E7EB; background: white; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; }
    .expand-btn:hover { background: #F9FAFB; border-color: #D1D5DB; }
    
    .preview-area { background: #FFFFFF; border-radius: 20px; overflow: hidden; min-height: 600px; position: relative; display: flex; align-items: center; justify-content: center; }
    
    /* Screenshot View (Figma) */
    .screenshot-container { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; position: relative; }
    .preview-image { width: 100%; height: 100%; object-fit: contain; display: block; max-height: 700px; transition: opacity 0.3s ease; }
    .preview-image.loading { opacity: 0; }
    
    /* Layer loading overlay */
    .layer-loading-overlay { position: absolute; inset: 0; background: rgba(255,255,255,0.9); display: none; align-items: center; justify-content: center; z-index: 5; }
    .layer-loading-overlay.show { display: flex; }
    .mini-spinner { width: 32px; height: 32px; border: 3px solid #E5E7EB; border-top: 3px solid #3B82F6; border-radius: 50%; animation: spin 0.8s linear infinite; }
    
    /* PDF Iframe View */
    .iframe-container { width: 100%; height: 100%; position: relative; }
    .design-frame { width: 100%; height: 650px; border: none; display: block; }

    .loading-overlay { position: absolute; inset: 0; background: rgba(255,255,255,0.98); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 10; }
    .loading-overlay.hidden { display: none; }
    .spinner { width: 32px; height: 32px; border: 3px solid #E5E7EB; border-top: 3px solid #3B82F6; border-radius: 50%; animation: spin 0.8s linear infinite; }
    .loading-text-small { margin-top: 12px; color: #6B7280; font-size: 14px; font-weight: 500; }

    /* Info panels */
    .info-column { display: flex; flex-direction: column; gap: 16px; padding-top: 24px; }
    .info-panel.usage-terms { background: #FFFFFF; border-radius: 20px; overflow: hidden; border: 1px solid #FDE68A; }
    .info-panel.usage-terms h3 { font-size: 16px; font-weight: 600; color: #92400E; background: #FFFBEB; padding: 14px 16px; margin: 0; border-bottom: 1px solid #FDE68A; }
    .info-panel.usage-terms ul { margin-left: 18px; color: #374151; font-size: 13px; line-height: 1.7; padding: 16px; }
    .info-panel.usage-terms li { margin-bottom: 6px; }
    
    .info-panel.documentation { background: #FFFFFF; border-radius: 20px; overflow: hidden; border: 1px solid #BFDBFE; }
    .info-panel.documentation h3 { font-size: 16px; font-weight: 600; color: #1E40AF; background: #EFF6FF; padding: 14px 16px; margin: 0; border-bottom: 1px solid #BFDBFE; }
    .info-panel.documentation ul { margin-left: 18px; color: #374151; font-size: 13px; line-height: 1.7; padding: 16px; }
    .info-panel.documentation li { margin-bottom: 6px; }

    /* Responsive */
    @media (max-width: 1100px) {
      .page-container { grid-template-columns: 1fr; padding: 20px; gap: 20px; }
      .design-frame { height: 500px; }
      .info-column { flex-direction: row; gap: 16px; }
      .info-panel { flex: 1; }
    }

    @media (max-width: 768px) {
      .page-container { padding: 16px; }
      .navbar { padding: 16px 20px; }
      .nav-title { font-size: 18px; }
      .nav-meta { font-size: 13px; }
      .preview-header { flex-direction: column; align-items: flex-start; }
      .preview-controls { width: 100%; justify-content: flex-end; }
      .info-column { flex-direction: column; }
      .design-frame { height: 450px; }
      .loading-logo { font-size: 24px; }
    }
  </style>
</head>
<body>
  <!-- Loading Screen -->
  <div class="loading-screen" id="loadingScreen">
    <div class="loading-logo">The BYND</div>
    <div class="loading-spinner"></div>
    <div class="loading-text">Loading design submission...</div>
    <div class="loading-subtext">Preparing ${layers.length > 0 ? layers.length + ' pages' : 'your preview'}</div>
  </div>

  <!-- Main Content -->
  <div class="main-content" id="mainContent">
    <div class="navbar">
      <div class="nav-content">
        <div class="nav-title">${design.position}</div>
        <div class="nav-meta">${design.company_name} • Submitted on ${new Date(design.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}</div>
      </div>
    </div>

    <div class="page-container">
      <div class="content-area">
        <div class="preview-header">
          ${design.design_type === 'figma' && layers.length > 0 ? `
          <select class="page-dropdown" id="pageSelect" onchange="switchPage(this.value)">
            ${layers.map((layer, idx) => `<option value="${idx}" ${idx === 0 ? 'selected' : ''}>${layer.layer_name}</option>`).join('')}
          </select>
          ` : '<div></div>'}
          
          <div class="preview-controls">
            <button class="expand-btn" onclick="toggleFullscreen()" title="Expand to fullscreen">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="preview-area" id="previewArea">
          ${design.design_type === 'figma' ? `
          <!-- FIGMA: Screenshot preview with layer switching -->
          <div class="screenshot-container" id="screenshotContainer">
            <div class="layer-loading-overlay" id="layerLoadingOverlay">
              <div class="mini-spinner"></div>
            </div>
            ${defaultLayerUrl ? `<img src="${defaultLayerUrl}" alt="Design Preview" class="preview-image loading" id="previewImage">` : `<div style="color:#9CA3AF;font-size:14px;">Loading preview...</div>`}
          </div>
          ` : `
          <!-- PDF: Iframe view without toolbar -->
          <div class="iframe-container" id="iframeContainer">
            <div class="loading-overlay" id="loadingOverlay">
              <div class="spinner"></div>
              <div class="loading-text-small">Loading PDF...</div>
            </div>
            <iframe id="designFrame" class="design-frame" src="${fullViewUrl}"></iframe>
          </div>
          `}
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
    const layers = ${layersJSON};
    const designType = '${design.design_type}';
    const loadingDuration = ${loadingDuration};
    let currentLayerIndex = 0;
    let isLayerSwitching = false;
    const preloadedImages = new Map();

    const loadingScreen = document.getElementById('loadingScreen');
    const mainContent = document.getElementById('mainContent');
    const previewArea = document.getElementById('previewArea');
    const screenshotContainer = document.getElementById('screenshotContainer');
    const previewImage = document.getElementById('previewImage');
    const layerLoadingOverlay = document.getElementById('layerLoadingOverlay');
    const iframeContainer = document.getElementById('iframeContainer');
    const designFrame = document.getElementById('designFrame');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const pageSelect = document.getElementById('pageSelect');

    // Preload all Figma layer images
    function preloadAllLayers() {
      if (designType !== 'figma' || layers.length === 0) return;
      
      console.log(' Preloading all layers...');
      
      layers.forEach((layer, idx) => {
        if (layer.layer_preview_url) {
          const img = new Image();
          img.onload = () => {
            preloadedImages.set(idx, img);
            console.log(\`Preloaded layer \${idx}: \${layer.layer_name}\`);
          };
          img.onerror = () => {
            console.error(\` Failed to preload layer \${idx}: \${layer.layer_name}\`);
          };
          img.src = layer.layer_preview_url;
        }
      });
    }

    // Hide loading screen and show content
    setTimeout(() => {
      loadingScreen.classList.add('fade-out');
      mainContent.classList.add('visible');
      
      setTimeout(() => {
        loadingScreen.style.display = 'none';
      }, 500);

      // Start preloading for Figma designs
      if (designType === 'figma') {
        preloadAllLayers();
        
        if (previewImage) {
          previewImage.onload = () => {
            previewImage.classList.remove('loading');
          };
          setTimeout(() => {
            if (previewImage.classList.contains('loading')) {
              previewImage.classList.remove('loading');
            }
          }, 1000);
        }
      }
    }, loadingDuration);

    // For PDF: Hide loading overlay after iframe loads
    if (designType === 'pdf' && designFrame && loadingOverlay) {
      designFrame.onload = () => {
        loadingOverlay.classList.add('hidden');
      };
      setTimeout(() => {
        loadingOverlay.classList.add('hidden');
      }, 3000);
    }

    // Figma layer switching with preloading
    function switchLayer(layerIndex) {
      if (isLayerSwitching || layerIndex === currentLayerIndex || layers.length === 0) return;
      
      const layer = layers[layerIndex];
      if (!layer || !layer.layer_preview_url || !previewImage) return;

      isLayerSwitching = true;

      if (pageSelect) pageSelect.disabled = true;

      if (layerLoadingOverlay) {
        layerLoadingOverlay.classList.add('show');
      }

      previewImage.classList.add('loading');

      if (preloadedImages.has(layerIndex)) {
        const cachedImg = preloadedImages.get(layerIndex);
        previewImage.src = cachedImg.src;
        
        setTimeout(() => {
          previewImage.classList.remove('loading');
          if (layerLoadingOverlay) {
            layerLoadingOverlay.classList.remove('show');
          }
          if (pageSelect) pageSelect.disabled = false;
          isLayerSwitching = false;
          currentLayerIndex = layerIndex;
          console.log(\`Switched to layer \${layerIndex} (from cache)\`);
        }, 100);
      } else {
        const img = new Image();
        
        img.onload = () => {
          previewImage.src = img.src;
          preloadedImages.set(layerIndex, img);
          
          requestAnimationFrame(() => {
            setTimeout(() => {
              previewImage.classList.remove('loading');
              if (layerLoadingOverlay) {
                layerLoadingOverlay.classList.remove('show');
              }
              if (pageSelect) pageSelect.disabled = false;
              isLayerSwitching = false;
              currentLayerIndex = layerIndex;
              console.log(\` Switched to layer \${layerIndex} (loaded)\`);
            }, 100);
          });
        };

        img.onerror = () => {
          console.error(\`Failed to load layer \${layerIndex}: \${layer.layer_name}\`);
          previewImage.classList.remove('loading');
          if (layerLoadingOverlay) {
            layerLoadingOverlay.classList.remove('show');
          }
          if (pageSelect) pageSelect.disabled = false;
          isLayerSwitching = false;
          
          alert(\`Failed to load page: \${layer.layer_name}. Please try again.\`);
        };

        img.src = layer.layer_preview_url;
      }
    }

    function switchPage(value) {
      const idx = Number(value);
      if (!isNaN(idx) && idx >= 0 && idx < layers.length) {
        switchLayer(idx);
      }
    }

    function toggleFullscreen() {
      if (!document.fullscreenElement) {
        previewArea.requestFullscreen().catch(err => console.error('Fullscreen error:', err));
      } else {
        document.exitFullscreen();
      }
    }

    // Initialize Figma layer 0
    if (designType === 'figma' && layers.length > 0 && pageSelect) {
      pageSelect.value = '0';
      currentLayerIndex = 0;
    }

    // Prevent page select changes while switching
    if (pageSelect) {
      pageSelect.addEventListener('mousedown', (e) => {
        if (isLayerSwitching) {
          e.preventDefault();
        }
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