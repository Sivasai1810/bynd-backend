import express from "express";
import { supabase_connect } from "../supabase/set-up.js";
import multer from "multer";
import puppeteer from "puppeteer";
import sharp from "sharp";
import axios from "axios";

const router = express.Router();

// Configure multer for PDF uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

// Extract Figma File Key from URL
function extractFigmaFileKey(url) {
  const match = url.match(/figma\.com\/(design|file)\/([a-zA-Z0-9]+)/);
  return match ? match[2] : null;
}

// Fetch Figma Frames/Layers using Figma API
async function fetchFigmaLayers(figmaUrl) {
  try {
    const fileKey = extractFigmaFileKey(figmaUrl);
    if (!fileKey) {
      console.error("Invalid Figma URL");
      return [];
    }

    const FIGMA_ACCESS_TOKEN = process.env.FIGMA_ACCESS_TOKEN;
    if (!FIGMA_ACCESS_TOKEN) {
      console.error(" FIGMA_ACCESS_TOKEN not found in environment variables");
      return [];
    }

    const response = await axios.get(`https://api.figma.com/v1/files/${fileKey}`, {
      headers: {
        'X-Figma-Token': FIGMA_ACCESS_TOKEN
      }
    });

    const document = response.data.document;
    const layers = [];

    if (document.children) {
      document.children.forEach((page) => {
        if (page.children) {
          page.children.forEach((frame) => {
            if (frame.type === 'FRAME' || frame.type === 'COMPONENT') {
              layers.push({
                layer_name: frame.name,
                layer_order: layers.length,
                node_id: frame.id,
                page_name: page.name
              });
            }
          });
        }
      });
    }

    console.log(` Found ${layers.length} layers in Figma file`);
    return layers;

  } catch (error) {
    console.error(" Error fetching Figma layers:", error.message);
    return [];
  }
}

// Generate shareable link
function generateShareableLink(uniqueId) {
  return `https://bynd-backend.onrender.com/BYNDLINK/view/${uniqueId}`;
}

// Generate Figma screenshot - NEW STRUCTURE: userId/submissionId/layerName_layerNumber.png
async function generateFigmaScreenshot(figmaUrl, nodeId, userId, submissionId, layerName, layerNumber) {
  try {
    const fileKey = extractFigmaFileKey(figmaUrl);
    const FIGMA_ACCESS_TOKEN = process.env.FIGMA_ACCESS_TOKEN;
    
    if (!fileKey || !FIGMA_ACCESS_TOKEN) {
      console.error("Missing Figma credentials");
      return null;
    }

    if (!nodeId) {
      console.log(" No nodeId provided, skipping screenshot...");
      return null;
    }

    console.log(` Generating Figma screenshot for layer: ${layerName} (${layerNumber})...`);

    // Use Figma Images API to get screenshot URL
    const imageApiUrl = `https://api.figma.com/v1/images/${fileKey}?ids=${nodeId}&format=png&scale=2`;

    const imageResponse = await axios.get(imageApiUrl, {
      headers: { 'X-Figma-Token': FIGMA_ACCESS_TOKEN }
    });

    const imageUrls = imageResponse.data.images;
    const imageUrl = imageUrls[nodeId];

    if (!imageUrl) {
      console.error("No image URL returned from Figma API");
      return null;
    }

    // Download the image
    const imageBuffer = await axios.get(imageUrl, { 
      responseType: 'arraybuffer' 
    });

    // Optimize image
    const optimizedImage = await sharp(Buffer.from(imageBuffer.data))
      .resize(2560, null, { fit: 'inside', withoutEnlargement: true })
      .png({ quality: 90, compressionLevel: 9 })
      .toBuffer();

    // NEW STRUCTURE: userId/submissionId/layerName_layerNumber.png (no layers subfolder)
    const sanitizedLayerName = layerName.replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `${userId}/${submissionId}/${sanitizedLayerName}_${layerNumber}.png`;
    
    const { data: uploadData, error: uploadError } = await supabase_connect.storage
      .from('design_previews')
      .upload(fileName, optimizedImage, {
        contentType: 'image/png',
        cacheControl: '3600',
        upsert: true
      });

    if (uploadError) {
      console.error(` Screenshot upload error:`, uploadError);
      return null;
    }

    console.log(` Screenshot generated: ${fileName}`);
    return fileName;

  } catch (error) {
    console.error(` Screenshot generation error:`, error.message);
    return null;
  }
}

// Generate PDF preview (first page)
async function generatePdfPreview(pdfPath, userId, submissionId) {
  let browser;
  try {
    console.log(` Generating PDF preview for submission ${submissionId}...`);

    const { data: signedUrlData, error: signedUrlError } = await supabase_connect.storage
      .from('design_files')
      .createSignedUrl(pdfPath, 300);

    if (signedUrlError) {
      console.error(" Signed URL error:", signedUrlError);
      return null;
    }

    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 2560, height: 1440 });
    await page.goto(signedUrlData.signedUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 3000));

    const screenshot = await page.screenshot({ type: 'png', quality: 90 });
    const optimizedImage = await sharp(screenshot)
      .resize(2560, 1440, { fit: 'cover' })
      .png({ quality: 90 })
      .toBuffer();

    // Structure: userId/submissionId/preview.png
    const fileName = `${userId}/${submissionId}/preview.png`;
    await supabase_connect.storage
      .from('design_previews')
      .upload(fileName, optimizedImage, {
        contentType: 'image/png',
        cacheControl: '3600',
        upsert: true
      });

    console.log(` PDF Preview generated: ${fileName}`);
    return fileName;

  } catch (error) {
    console.error(" PDF preview error:", error);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// POST route
router.post('', upload.single('pdf_file'), async (req, res) => {
  try {
    const { 
      user_id,
      unique_id,
      design_type,
      original_url,
      company_name,
      position,
      status = 'pending'
    } = req.body;

    // Validations
    if (!user_id || !unique_id || !design_type || !company_name || !position) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!['figma', 'pdf'].includes(design_type)) {
      return res.status(400).json({ error: "Invalid design_type" });
    }

    if (design_type === 'figma' && (!original_url || !original_url.includes('figma.com'))) {
      return res.status(400).json({ error: "Valid Figma URL required" });
    }

    if (design_type === 'pdf' && !req.file) {
      return res.status(400).json({ error: "PDF file required" });
    }

    // Handle PDF upload
    let pdf_file_path = null;
    if (design_type === 'pdf' && req.file) {
      const fileName = `${user_id}/${unique_id}/document.pdf`;
      const { data: uploadData, error: uploadError } = await supabase_connect.storage
        .from('design_files')
        .upload(fileName, req.file.buffer, {
          contentType: 'application/pdf',
          upsert: false
        });

      if (uploadError) {
        return res.status(500).json({ error: "PDF upload failed", details: uploadError.message });
      }

      pdf_file_path = uploadData.path;
      console.log(` PDF uploaded: ${pdf_file_path}`);
    }

    // Generate shareable link
    const shareableLink = generateShareableLink(unique_id);

    // Prepare submission data
    const submissionData = {
      user_id,
      unique_id,
      design_type,
      original_url: design_type === 'figma' ? original_url : null,
      pdf_file_path: design_type === 'pdf' ? pdf_file_path : null,
      company_name,
      position,
      status,
      shareable_link: shareableLink,
      preview_thumbnail: null,
      created_at: new Date().toISOString()
    };

    // Insert submission
    const { data: submission, error: insertError } = await supabase_connect
      .from("design_submissions")
      .insert([submissionData])
      .select()
      .single();

    if (insertError) {
      if (pdf_file_path) {
        await supabase_connect.storage.from('design_files').remove([pdf_file_path]);
      }
      return res.status(500).json({ error: "Failed to store submission", details: insertError.message });
    }

    console.log(`Submission stored successfully with UUID: ${submission.id}`);

    // ===== FIGMA: Extract layers and generate screenshots =====
    if (design_type === 'figma' && original_url) {
      console.log("Processing Figma design...");
      
      // Process layers asynchronously
      fetchFigmaLayers(original_url).then(async (layers) => {
        if (layers.length > 0) {
          // Store layer metadata
          const layerData = layers.map(layer => ({
            submission_id: submission.id,
            user_id: user_id,
            layer_name: layer.layer_name,
            layer_order: layer.layer_order,
            layer_preview_url: null,
            created_at: new Date().toISOString()
          }));

          const { data: insertedLayers, error: layerError } = await supabase_connect
            .from("design_layers")
            .insert(layerData)
            .select();

          if (!layerError && insertedLayers) {
            console.log(` Stored ${layers.length} layers for submission ${submission.id}`);
            
            // Generate screenshot for each layer
            for (let i = 0; i < insertedLayers.length; i++) {
              const layer = insertedLayers[i];
              const originalLayer = layers[i];
              
              const screenshotPath = await generateFigmaScreenshot(
                original_url,
                originalLayer.node_id,
                user_id,
                submission.id,
                layer.layer_name,
                layer.layer_order
              );

              if (screenshotPath) {
                await supabase_connect
                  .from("design_layers")
                  .update({ layer_preview_url: screenshotPath })
                  .eq('id', layer.id);
                
                console.log(` Layer ${layer.layer_order} screenshot stored at: ${screenshotPath}`);
              }
            }

            // Use first layer as main preview if available
            if (insertedLayers.length > 0 && insertedLayers[0].layer_preview_url) {
              await supabase_connect
                .from("design_submissions")
                .update({ preview_thumbnail: insertedLayers[0].layer_preview_url })
                .eq('id', submission.id);
            }
          }
        } else {
          console.log(" No layers found in Figma file");
        }
      }).catch(error => {
        console.error(" Error processing Figma layers:", error);
      });
    }

    // ===== PDF: Generate preview =====
    if (design_type === 'pdf' && pdf_file_path) {
      generatePdfPreview(pdf_file_path, user_id, submission.id)
        .then(async (previewPath) => {
          if (previewPath) {
            await supabase_connect
              .from("design_submissions")
              .update({ preview_thumbnail: previewPath })
              .eq('id', submission.id);
          }
        });
    }

    return res.status(201).json({ 
      success: true,
      message: "Design submission created successfully", 
      submission: {
        ...submission,
        original_url: undefined
      },
      shareable_link: shareableLink,
      design_type: design_type
    });

  } catch (err) {
    console.error(" Server error:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

export default router;