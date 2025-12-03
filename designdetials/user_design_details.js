import express from "express";
import { supabase_connect } from "../supabase/set-up.js";
import multer from "multer";
import puppeteer from "puppeteer";
import sharp from "sharp";
import axios from "axios";
import pLimit from "p-limit"; // npm install p-limit
import http from "http";
import https from "https";

const router = express.Router();

// === HTTP Agent for connection pooling ===
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

// === Axios instance with defaults ===
const axiosInstance = axios.create({
  timeout: 30000,
  httpAgent,
  httpsAgent,
});

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

const getCleanFigmaToken = () => {
  const token = process.env.FIGMA_ACCESS_TOKEN;
  if (!token) throw new Error("Missing FIGMA_ACCESS_TOKEN");
  return token.trim().replace(/[\r\n\t]/g, '');
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// === OPTIMIZED: Fetch Figma layers ===
async function fetchFigmaLayers(figmaUrl) {
  try {
    const fileKey = extractFigmaFileKey(figmaUrl);
    if (!fileKey) return [];
    
    const FIGMA_ACCESS_TOKEN = getCleanFigmaToken();

    const { data } = await axiosInstance.get(
      `https://api.figma.com/v1/files/${fileKey}`,
      { headers: { "X-Figma-Token": FIGMA_ACCESS_TOKEN } }
    );

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
    console.error(" Figma layers fetch error:", err.message);
    return [];
  }
}

// === OPTIMIZED: Fetch ALL image URLs in larger chunks with smart retry ===
async function fetchFigmaImageUrls(figmaUrl, nodeIds) {
  try {
    const fileKey = extractFigmaFileKey(figmaUrl);
    if (!fileKey || !nodeIds.length) return {};

    const FIGMA_ACCESS_TOKEN = getCleanFigmaToken();
    const CHUNK_SIZE = 10; // Increased from 3 to 10
    const MAX_RETRIES = 2; // Reduced from 3 to 2
    const allImages = {};

    // Process chunks in parallel with concurrency limit
    const limit = pLimit(3); // Process 3 chunks simultaneously
    
    const chunkPromises = [];
    for (let i = 0; i < nodeIds.length; i += CHUNK_SIZE) {
      const chunk = nodeIds.slice(i, i + CHUNK_SIZE);
      
      chunkPromises.push(
        limit(async () => {
          let retries = 0;
          
          while (retries < MAX_RETRIES) {
            try {
              const { data } = await axiosInstance.get(
                `https://api.figma.com/v1/images/${fileKey}`,
                {
                  params: { ids: chunk.join(','), format: 'png', scale: 2 },
                  headers: { "X-Figma-Token": FIGMA_ACCESS_TOKEN },
                }
              );

              if (data.images) {
                return data.images;
              }
              break;
            } catch (err) {
              retries++;
              if (retries < MAX_RETRIES) {
                await delay(1000 * retries); // Linear backoff: 1s, 2s
              } else {
                console.error(`Failed chunk after ${MAX_RETRIES} attempts`);
                return {};
              }
            }
          }
          return {};
        })
      );
    }

    // Wait for all chunks and merge results
    const results = await Promise.all(chunkPromises);
    results.forEach(images => Object.assign(allImages, images));

    console.log(` Fetched ${Object.keys(allImages).length}/${nodeIds.length} image URLs`);
    return allImages;
  } catch (err) {
    console.error(" Fatal error in fetchFigmaImageUrls:", err.message);
    return {};
  }
}

// === OPTIMIZED: Download and upload with streaming ===
async function downloadAndUploadFigmaImage(imageUrl, userId, submissionId, layerName, layerOrder) {
  try {
    if (!imageUrl) {
      console.warn(` No image URL for ${layerName}`);
      return null;
    }

    // Download with retry (single attempt, fail fast)
    const imageResponse = await axiosInstance.get(imageUrl, {
      responseType: 'arraybuffer',
    }).catch(async (err) => {
      // One retry only
      await delay(1000);
      return axiosInstance.get(imageUrl, { responseType: 'arraybuffer' });
    });

    // Optimize image (streaming pipeline)
    const optimized = await sharp(Buffer.from(imageResponse.data))
      .resize(2560, null, { fit: "inside", withoutEnlargement: true })
      .png({ quality: 85, compressionLevel: 6 }) // Slightly lower quality for speed
      .toBuffer();

    // Upload to Supabase
    const sanitizedLayerName = layerName.replace(/[^a-zA-Z0-9]/g, '_');
    const filePath = `${userId}/${submissionId}/${sanitizedLayerName}_${layerOrder}.png`;
    
    const { error: uploadError } = await supabase_connect.storage
      .from("design_previews")
      .upload(filePath, optimized, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError) throw new Error(uploadError.message);

    return filePath;
  } catch (err) {
    console.error(` Failed to process ${layerName}:`, err.message);
    return null;
  }
}

// === OPTIMIZED: Generate preview with single retry ===
async function generateFigmaPreview(figmaUrl, nodeId, userId, submissionId) {
  try {
    const fileKey = extractFigmaFileKey(figmaUrl);
    if (!fileKey || !nodeId) return null;

    const FIGMA_ACCESS_TOKEN = getCleanFigmaToken();

    const { data } = await axiosInstance.get(
      `https://api.figma.com/v1/images/${fileKey}`,
      {
        params: { ids: nodeId, format: 'png', scale: 2 },
        headers: { "X-Figma-Token": FIGMA_ACCESS_TOKEN },
      }
    );

    const imageUrl = data.images?.[nodeId];
    if (!imageUrl) throw new Error("No image URL");

    const imageResponse = await axiosInstance.get(imageUrl, {
      responseType: 'arraybuffer',
    });

    const optimized = await sharp(Buffer.from(imageResponse.data))
      .resize(2560, null, { fit: "inside", withoutEnlargement: true })
      .png({ quality: 85, compressionLevel: 6 })
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
    console.error(` Preview generation failed:`, err.message);
    return null;
  }
}

// === OPTIMIZED: Process layers with higher concurrency ===
async function storeFigmaLayersWithImages(submissionId, userId, figmaUrl, layers) {
  try {
    if (!layers || layers.length === 0) return false;

    console.log(`Processing ${layers.length} layers...`);

    // Fetch ALL image URLs at once
    const nodeIds = layers.map(l => l.node_id);
    const imageUrls = await fetchFigmaImageUrls(figmaUrl, nodeIds);

    // Process images with controlled concurrency (8 at a time)
    const limit = pLimit(8); // Increased from 3 to 8
    
    const layersToInsert = await Promise.all(
      layers.map((layer, index) =>
        limit(async () => {
          const imageUrl = imageUrls[layer.node_id];
          
          const storagePath = await downloadAndUploadFigmaImage(
            imageUrl,
            userId,
            submissionId,
            layer.layer_name,
            index
          );

          return {
            submission_id: submissionId,
            user_id: userId,
            layer_name: layer.layer_name,
            layer_order: index,
            layer_preview_url: storagePath,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
        })
      )
    );

    // Batch insert all layers
    const { error } = await supabase_connect
      .from("design_layers")
      .insert(layersToInsert)
      .select();

    if (error) {
      console.error("Database insert error:", error.message);
      return false;
    }

    const successCount = layersToInsert.filter(l => l.layer_preview_url !== null).length;
    console.log(` Successfully stored ${successCount}/${layers.length} layers`);
    return true;
  } catch (err) {
    console.error(" Error in storeFigmaLayersWithImages:", err.message);
    return false;
  }
}

// === Image preview (unchanged) ===
async function generateImagePreview(imageBuffer, userId, submissionId) {
  try {
    const optimized = await sharp(imageBuffer)
      .resize(2560, null, { fit: "inside", withoutEnlargement: true })
      .png({ quality: 85, compressionLevel: 6 })
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
    console.error(" Image preview error:", err);
    return null;
  }
}

// === PDF preview (unchanged) ===
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
    console.error(" PDF preview error:", err.message);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}
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

    if (!user_id || !unique_id || !design_type || !company_name || !position) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    let normalizedType = design_type.trim().toLowerCase();
    if (["image", "png", "jpeg", "jpg"].includes(normalizedType))
      normalizedType = "pdf";

    if (!["figma", "pdf"].includes(normalizedType)) {
      return res.status(400).json({
        error: `Invalid design_type: ${design_type}. Must be 'figma' or 'pdf'.`,
      });
    }

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
        console.error("File upload error:", error.message);
        return res.status(500).json({
          error: "File upload failed",
          details: error.message,
        });
      }

      file_path = data.path;
    }

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

    const { data: submission, error: insertError } = await supabase_connect
      .from("design_submissions")
      .insert([submissionData])
      .select()
      .single();

    if (insertError) {
      console.error(" Insert failed:", insertError.message);
      return res.status(500).json({
        error: "Failed to store submission",
        details: insertError.message,
      });
    }

    console.log("Submission created:", submission.id);

    // Process previews & layers
    if (normalizedType === "figma" && original_url) {
      const layers = await fetchFigmaLayers(original_url);
      
      if (layers.length > 0) {
        console.log(` Found ${layers.length} Figma layers`);
        
        // Process layers and preview in parallel
        const [, previewPath] = await Promise.all([
          storeFigmaLayersWithImages(submission.id, user_id, original_url, layers),
          generateFigmaPreview(original_url, layers[0].node_id, user_id, submission.id)
        ]);
        
        if (previewPath) {
          await supabase_connect
            .from("design_submissions")
            .update({ preview_thumbnail: previewPath })
            .eq("id", submission.id);
        }
      }
    } else if (req.file && req.file.mimetype === "application/pdf") {
      const preview = await generatePdfPreview(file_path, user_id, submission.id);
      if (preview) {
        await supabase_connect
          .from("design_submissions")
          .update({ preview_thumbnail: preview })
          .eq("id", submission.id);
      }
    } else if (req.file && req.file.mimetype.startsWith("image/")) {
      const preview = await generateImagePreview(req.file.buffer, user_id, submission.id);
      if (preview) {
        await supabase_connect
          .from("design_submissions")
          .update({ preview_thumbnail: preview })
          .eq("id", submission.id);
      }
    }

    return res.status(201).json({
      success: true,
      message: "Design submission created successfully",
      shareable_link: shareableLink,
      submission,
    });
  } catch (err) {
    console.error(" Server error:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

export default router;