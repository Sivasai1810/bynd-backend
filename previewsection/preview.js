import express from "express";
import { supabase_connect } from "../supabase/set-up.js";
import cookieParser from "cookie-parser";
const router = express.Router();
router.use(cookieParser());

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

    const loadingDuration = layers.length > 8 ? 19000 : (layers.length > 0 ? 10000 : 15000);

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
        console.log(` View tracked for ${uniqueId}. Status: ${design.status} → ${newStatus}, Views: ${currentViews} → ${currentViews + 1}`);
      }

      res.cookie(viewCookieName, 'true', {
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true
      });

    } else {
      console.log(` Duplicate view prevented for ${uniqueId} (cookie exists)`);
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
const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${design.position} - ${design.company_name}</title>
  
  <style>
    @font-face {
      font-family: 'Circular Std';
      src: url('/preview/fonts/circular-std/CircularStd-Book.ttf') format('truetype');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Circular Std';
      src: url('/preview/fonts/circular-std/CircularStd-Medium.ttf') format('truetype');
      font-weight: 500;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Circular Std';
      src: url('/preview/fonts/circular-std/CircularStd-Bold.ttf') format('truetype');
      font-weight: 700;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Circular Std';
      src: url('/preview/fonts/circular-std/CircularStd-Black.ttf') format('truetype');
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
    /* Loading Screen */
    .loading-screen { position: fixed; inset: 0; background: #FFFFFF; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 9999; transition: opacity 0.5s ease; }
    .loading-screen.fade-out { opacity: 0; pointer-events: none; }
    .loading-logo { font-size: 28px; font-weight: 700; color: #111827; margin-bottom: 24px; letter-spacing: -0.5px; }
    .loading-spinner { width: 48px; height: 48px; border: 4px solid #E5E7EB; border-top: 4px solid #3B82F6; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 16px; }
    .loading-text { color: #6B7280; font-size: 15px; font-weight: 500; margin-bottom: 8px; }
    .loading-subtext { color: #9CA3AF; font-size: 13px; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

    /* Main Content */
    .main-content { opacity: 0; transition: opacity 0.5s ease; }
    .main-content.visible { opacity: 1; }

    /* Navbar */
    .navbar { background: #FFFFFF; padding: 20px 32px; border-bottom: 2px solid #E5E7EB; }
    .nav-content { max-width: 1400px; margin: 0 auto; }
    .nav-title { font-size: 22px; font-weight: 600; color: #111827; margin-bottom: 6px; }
    .nav-meta { font-size: 14px; color: #6B7280; }

    /* Page Container */
    .page-container { max-width: 1400px; margin: 0 auto; padding: 0 32px 24px 32px; display: grid; grid-template-columns: 1fr 300px; gap: 24px; align-items: start; }

    /* Content Area */
    .content-area { background: #F9FAFB; border-radius: 0; padding: 24px 20px 20px 20px; min-height: 600px; position: relative; }

    /*  Custom Dropdown - Clean Figma Style */
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

    /* Dropdown Menu */
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

    /* Preview Header */
    .preview-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 12px; }
    .preview-controls { display: flex; gap: 8px; align-items: center; }

    /* Expand Button */
    .expand-btn { width: 36px; height: 36px; border-radius: 10px; border: 1px solid #E5E7EB; background: white; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; }
    .expand-btn:hover { background: #F9FAFB; border-color: #D1D5DB; }

    /* Preview Area */
    .preview-area { background: #FFFFFF; border-radius: 20px; overflow: hidden; min-height: 600px; position: relative; display: flex; align-items: center; justify-content: center; }

    /* Figma Screenshot View */
    .screenshot-container { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; position: relative; }
    .preview-image { width: 100%; height: 100%; object-fit: contain; display: block; max-height: 700px; transition: opacity 0.3s ease; }
    .preview-image.loading { opacity: 0; }

    /* Layer Loading Overlay */
    .layer-loading-overlay { position: absolute; inset: 0; background: rgba(255,255,255,0.9); display: none; align-items: center; justify-content: center; z-index: 5; }
    .layer-loading-overlay.show { display: flex; }
    .mini-spinner { width: 32px; height: 32px; border: 3px solid #E5E7EB; border-top: 3px solid #3B82F6; border-radius: 50%; animation: spin 0.8s linear infinite; }

    /* PDF Iframe */
    .iframe-container { width: 90%; height: 90%; position: relative; }
    .design-frame { width: 90%; height: 600px; border: none; display: block; }

    /* PDF Loading Overlay */
    .loading-overlay { position: absolute; inset: 0; background: rgba(255,255,255,0.98); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 10; }
    .loading-overlay.hidden { display: none; }
    .spinner { width: 32px; height: 32px; border: 3px solid #E5E7EB; border-top: 3px solid #3B82F6; border-radius: 50%; animation: spin 0.8s linear infinite; }
    .loading-text-small { margin-top: 12px; color: #6B7280; font-size: 14px; font-weight: 500; }

    /* Info Panels */
    .info-column { display: flex; flex-direction: column; gap: 16px; padding-top: 24px; }
    .info-panel.usage-terms { background: #FFFFFF; border-radius: 10px; overflow: hidden; border: 1px solid #FDE68A; }
    .info-panel.usage-terms h3 { font-size: 16px; font-weight: 600; color: #92400E; background: #FFFBEB; padding: 14px 16px; margin: 0; border-bottom: 1px solid #FDE68A; }
    .info-panel.usage-terms ul { margin-left: 18px; color: #374151; font-size: 13px; line-height: 1.7; padding: 16px; }
    .info-panel.usage-terms li { margin-bottom: 6px; }

    .info-panel.documentation { background: #FFFFFF; border-radius: 10px; overflow: hidden; border: 1px solid #BFDBFE; }
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
      .custom-dropdown { width: 100%; }
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
          <!-- Custom Dropdown -->
          <div class="custom-dropdown" id="customDropdown">
            <div class="dropdown-trigger" id="dropdownTrigger">
              <div class="dropdown-label">
                <span class="dropdown-label-prefix">Page:</span>
                <span id="selectedOption">${layers[0].layer_name}</span>
              </div>
              <svg class="dropdown-chevron" id="dropdownChevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </div>
            <div class="dropdown-menu" id="dropdownMenu">
              ${layers.map((layer, idx) => `
                <div class="dropdown-option ${idx === 0 ? 'selected' : ''}" data-index="${idx}">
                  ${layer.layer_name}
                </div>
              `).join('')}
            </div>
          </div>
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

    // Custom Dropdown Logic
    const customDropdown = document.getElementById('customDropdown');
    const dropdownTrigger = document.getElementById('dropdownTrigger');
    const dropdownMenu = document.getElementById('dropdownMenu');
    const dropdownChevron = document.getElementById('dropdownChevron');
    const selectedOption = document.getElementById('selectedOption');

    if (customDropdown && dropdownTrigger && dropdownMenu) {
      // Toggle dropdown
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

      // Select option
      const dropdownOptions = dropdownMenu.querySelectorAll('.dropdown-option');
      dropdownOptions.forEach(option => {
        option.addEventListener('click', (e) => {
          e.stopPropagation();
          const index = parseInt(option.getAttribute('data-index'));
          selectOption(index);
        });
      });

      // Close dropdown when clicking outside
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
        if (index === currentLayerIndex) {
          closeDropdown();
          return;
        }

        // Update selected text
        selectedOption.textContent = layers[index].layer_name;

        // Update selected class
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

    // Preload all Figma layer images
    function preloadAllLayers() {
      if (designType !== 'figma' || layers.length === 0) return;
      
      console.log('Preloading all layers...');
      
      layers.forEach((layer, idx) => {
        if (layer.layer_preview_url) {
          const img = new Image();
          img.onload = () => {
            preloadedImages.set(idx, img);
            console.log(\` Preloaded layer \${idx}: \${layer.layer_name}\`);
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

      // Disable dropdown trigger
      if (dropdownTrigger) {
        dropdownTrigger.classList.add('disabled');
      }

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
          if (dropdownTrigger) {
            dropdownTrigger.classList.remove('disabled');
          }
          isLayerSwitching = false;
          currentLayerIndex = layerIndex;
          console.log(\` Switched to layer \${layerIndex} (from cache)\`);
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
              if (dropdownTrigger) {
                dropdownTrigger.classList.remove('disabled');
              }
              isLayerSwitching = false;
              currentLayerIndex = layerIndex;
              console.log(\` Switched to layer \${layerIndex} (loaded)\`);
            }, 100);
          });
        };

        img.onerror = () => {
          console.error(\` Failed to load layer \${layerIndex}: \${layer.layer_name}\`);
          previewImage.classList.remove('loading');
          if (layerLoadingOverlay) {
            layerLoadingOverlay.classList.remove('show');
          }
          if (dropdownTrigger) {
            dropdownTrigger.classList.remove('disabled');
          }
          isLayerSwitching = false;
          
          alert(\`Failed to load page: \${layer.layer_name}. Please try again.\`);
        };

        img.src = layer.layer_preview_url;
      }
    }

    function toggleFullscreen() {
      if (!document.fullscreenElement) {
        previewArea.requestFullscreen().catch(err => console.error('Fullscreen error:', err));
      } else {
        document.exitFullscreen();
      }
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