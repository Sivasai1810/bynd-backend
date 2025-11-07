import express from "express";
import { supabase_connect } from "../supabase/set-up.js";
import multer from "multer";
import puppeteer from "puppeteer";
import sharp from "sharp";
import axios from "axios";

const router = express.Router();

// === Multer Setup ===
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only PDF, PNG, and JPEG files are allowed"));
  },
});

// === Helpers ===
const extractFigmaFileKey = (url) => {
  const match = url.match(/figma\.com\/(design|file)\/([a-zA-Z0-9]+)/);
  return match ? match[2] : null;
};

const generateShareableLink = (uniqueId) =>
  `https://bynd-backend.onrender.com/BYNDLINK/view/${uniqueId}`;

// === Figma Layer Fetch ===
async function fetchFigmaLayers(figmaUrl) {
  try {
    const fileKey = extractFigmaFileKey(figmaUrl);
    if (!fileKey) return [];
    const FIGMA_ACCESS_TOKEN = process.env.FIGMA_ACCESS_TOKEN;
    if (!FIGMA_ACCESS_TOKEN) throw new Error("Missing FIGMA_ACCESS_TOKEN");

    const { data } = await axios.get(`https://api.figma.com/v1/files/${fileKey}`, {
      headers: { "X-Figma-Token": FIGMA_ACCESS_TOKEN },
    });

    const layers = [];
    data.document?.children?.forEach((page) => {
      page.children?.forEach((frame) => {
        if (["FRAME", "COMPONENT"].includes(frame.type)) {
          layers.push({
            layer_name: frame.name,
            layer_order: layers.length,
            node_id: frame.id,
            page_name: page.name,
          });
        }
      });
    });

    return layers;
  } catch (err) {
    console.error("❌ Figma layers fetch error:", err.message);
    return [];
  }
}

// === Download and Upload Figma Layer Image to Storage ===
async function downloadAndUploadFigmaImage(figmaUrl, nodeId, userId, submissionId, layerName, layerOrder) {
  try {
    const fileKey = extractFigmaFileKey(figmaUrl);
    if (!fileKey || !nodeId) return null;

    const FIGMA_ACCESS_TOKEN = process.env.FIGMA_ACCESS_TOKEN;
    if (!FIGMA_ACCESS_TOKEN) throw new Error("Missing FIGMA_ACCESS_TOKEN");

    console.log(`  🔄 Downloading image for layer: ${layerName}`);

    // Get image URL from Figma API
    const { data } = await axios.get(
      `https://api.figma.com/v1/images/${fileKey}`,
      {
        params: {
          ids: nodeId,
          format: 'png',
          scale: 2
        },
        headers: { "X-Figma-Token": FIGMA_ACCESS_TOKEN },
      }
    );

    const imageUrl = data.images?.[nodeId];
    if (!imageUrl) {
      console.error(`  ❌ No image URL returned from Figma for ${layerName}`);
      return null;
    }

    // Download the image
    const imageResponse = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000 // 30 second timeout
    });

    // Optimize image
    const optimized = await sharp(Buffer.from(imageResponse.data))
      .resize(2560, null, { fit: "inside", withoutEnlargement: true })
      .png({ quality: 90 })
      .toBuffer();

    // Upload to Supabase Storage
    const sanitizedLayerName = layerName.replace(/[^a-zA-Z0-9]/g, '_');
    const filePath = `${userId}/${submissionId}/${sanitizedLayerName}_${layerOrder}.png`;
    
    const { error: uploadError } = await supabase_connect.storage
      .from("design_previews")
      .upload(filePath, optimized, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError) {
      console.error(`  ❌ Upload error for ${layerName}:`, uploadError.message);
      return null;
    }

    console.log(`  ✅ Uploaded: ${filePath}`);
    return filePath;
  } catch (err) {
    console.error(`  ❌ Error processing ${layerName}:`, err.message);
    return null;
  }
}

// === Generate Figma Preview from Node (for thumbnail) ===
async function generateFigmaPreview(figmaUrl, nodeId, userId, submissionId) {
  try {
    const fileKey = extractFigmaFileKey(figmaUrl);
    if (!fileKey || !nodeId) return null;

    const FIGMA_ACCESS_TOKEN = process.env.FIGMA_ACCESS_TOKEN;
    if (!FIGMA_ACCESS_TOKEN) throw new Error("Missing FIGMA_ACCESS_TOKEN");

    // Get image URL from Figma API
    const { data } = await axios.get(
      `https://api.figma.com/v1/images/${fileKey}`,
      {
        params: {
          ids: nodeId,
          format: 'png',
          scale: 2
        },
        headers: { "X-Figma-Token": FIGMA_ACCESS_TOKEN },
      }
    );

    const imageUrl = data.images?.[nodeId];
    if (!imageUrl) {
      console.error("❌ No image URL returned from Figma");
      return null;
    }

    // Download the image
    const imageResponse = await axios.get(imageUrl, {
      responseType: 'arraybuffer'
    });

    // Optimize and upload
    const optimized = await sharp(Buffer.from(imageResponse.data))
      .resize(2560, null, { fit: "inside", withoutEnlargement: true })
      .png({ quality: 90 })
      .toBuffer();

    const filePath = `${userId}/${submissionId}/preview.png`;
    await supabase_connect.storage
      .from("design_previews")
      .upload(filePath, optimized, {
        contentType: "image/png",
        upsert: true,
      });

    console.log("✅ Figma preview generated:", filePath);
    return filePath;
  } catch (err) {
    console.error("❌ Figma preview generation error:", err.message);
    return null;
  }
}

// === Store Figma Layers in Database with Uploaded Images ===
async function storeFigmaLayersWithImages(submissionId, userId, figmaUrl, layers) {
  try {
    console.log("📊 Processing Figma layers with image uploads...");
    console.log(`   Total layers: ${layers.length}`);

    if (!layers || layers.length === 0) {
      console.log("⚠️ No layers to store");
      return false;
    }

    const layersToInsert = [];

    // Process each layer: download from Figma, upload to Storage
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      console.log(`\n📄 Processing layer ${i + 1}/${layers.length}: ${layer.layer_name}`);

      // Download from Figma and upload to Storage
      const storagePath = await downloadAndUploadFigmaImage(
        figmaUrl,
        layer.node_id,
        userId,
        submissionId,
        layer.layer_name,
        i
      );

      layersToInsert.push({
        submission_id: submissionId,
        user_id: userId,
        layer_name: layer.layer_name,
        layer_order: i,
        layer_preview_url: storagePath, // Store the storage path, not Figma URL
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }

    console.log("\n💾 Inserting layers into database...");

    const { data, error } = await supabase_connect
      .from("design_layers")
      .insert(layersToInsert)
      .select();

    if (error) {
      console.error("❌ Database insert error:", error.message);
      return false;
    }

    console.log(`✅ Successfully stored ${data.length} layers\n`);
    return true;
  } catch (err) {
    console.error("❌ Error in storeFigmaLayersWithImages:", err.message);
    return false;
  }
}

// === Generate Image Preview ===
async function generateImagePreview(imageBuffer, userId, submissionId) {
  try {
    const optimized = await sharp(imageBuffer)
      .resize(2560, null, { fit: "inside", withoutEnlargement: true })
      .png({ quality: 90 })
      .toBuffer();

    const filePath = `${userId}/${submissionId}/preview.png`;
    await supabase_connect.storage
      .from("design_previews")
      .upload(filePath, optimized, {
        contentType: "image/png",
        upsert: true,
      });

    return filePath;
  } catch (err) {
    console.error("❌ Image preview error:", err);
    return null;
  }
}

// === Generate PDF Preview ===
async function generatePdfPreview(pdfPath, userId, submissionId) {
  let browser;
  try {
    const { data: signed } = await supabase_connect.storage
      .from("design_files")
      .createSignedUrl(pdfPath, 300);

    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 2560, height: 1440 });
    await page.goto(signed.signedUrl, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 2000));

    const shot = await page.screenshot({ type: "png", quality: 90 });
    const optimized = await sharp(shot).resize(2560, null).png().toBuffer();
    const filePath = `${userId}/${submissionId}/preview.png`;

    await supabase_connect.storage
      .from("design_previews")
      .upload(filePath, optimized, {
        contentType: "image/png",
        upsert: true,
      });

    return filePath;
  } catch (err) {
    console.error("❌ PDF preview error:", err.message);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// === MAIN ROUTE ===
router.post("", upload.single("pdf_file"), async (req, res) => {
  try {
    const {
      user_id,
      unique_id,
      design_type,
      original_url,
      company_name,
      position,
      status = "pending",
    } = req.body;

    // Validation
    if (!user_id || !unique_id || !design_type || !company_name || !position) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Normalize Design Type
    let normalizedType = design_type.trim().toLowerCase();
    if (["image", "png", "jpeg", "jpg"].includes(normalizedType))
      normalizedType = "pdf";

    if (!["figma", "pdf"].includes(normalizedType)) {
      return res.status(400).json({
        error: `Invalid design_type: ${design_type}. Must be 'figma' or 'pdf'.`,
      });
    }

    // Handle File Upload
    let file_path = null;
    if (req.file) {
      const ext = req.file.mimetype.split("/")[1];
      const fileName = `${user_id}/${unique_id}/document.${ext}`;

      const { data, error } = await supabase_connect.storage
        .from("design_files")
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: true,
        });

      if (error) {
        console.error("❌ File upload error:", error.message);
        return res.status(500).json({
          error: "File upload failed",
          details: error.message,
        });
      }

      file_path = data.path;
    }

    // Prepare DB Entry
    const shareableLink = generateShareableLink(unique_id);

    const submissionData = {
      user_id,
      unique_id,
      design_type: normalizedType,
      original_url: normalizedType === "figma" ? original_url || null : null,
      pdf_file_path: req.file ? file_path : null,
      company_name,
      position,
      status,
      shareable_link: shareableLink,
      preview_thumbnail: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    console.log("📝 Inserting submission:", submissionData);

    // Insert Submission
    const { data: submission, error: insertError } = await supabase_connect
      .from("design_submissions")
      .insert([submissionData])
      .select()
      .single();

    if (insertError) {
      console.error("❌ Insert failed:", insertError.message);
      return res.status(500).json({
        error: "Failed to store submission",
        details: insertError.message,
      });
    }

    console.log(`✅ Submission created: ${submission.id}`);

    // Generate Previews & Store Layers
    if (normalizedType === "figma" && original_url) {
      console.log("\n🔍 Fetching Figma layers...");
      const layers = await fetchFigmaLayers(original_url);
      
      if (layers.length > 0) {
        console.log(`✅ Found ${layers.length} layers`);
        
        // Store layers WITH image uploads
        await storeFigmaLayersWithImages(submission.id, user_id, original_url, layers);
        
        // Generate main preview from first layer
        const firstLayer = layers[0];
        const previewPath = await generateFigmaPreview(
          original_url,
          firstLayer.node_id,
          user_id,
          submission.id
        );
        
        if (previewPath) {
          await supabase_connect
            .from("design_submissions")
            .update({ preview_thumbnail: previewPath })
            .eq("id", submission.id);
        }
      } else {
        console.log("⚠️ No Figma layers found");
      }
    } else if (req.file && req.file.mimetype === "application/pdf") {
      const preview = await generatePdfPreview(file_path, user_id, submission.id);
      if (preview)
        await supabase_connect
          .from("design_submissions")
          .update({ preview_thumbnail: preview })
          .eq("id", submission.id);
    } else if (req.file && req.file.mimetype.startsWith("image/")) {
      const preview = await generateImagePreview(req.file.buffer, user_id, submission.id);
      if (preview)
        await supabase_connect
          .from("design_submissions")
          .update({ preview_thumbnail: preview })
          .eq("id", submission.id);
    }

    return res.status(201).json({
      success: true,
      message: "Design submission created successfully",
      shareable_link: shareableLink,
      submission,
    });
  } catch (err) {
    console.error("❌ Server error:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

export default router;


