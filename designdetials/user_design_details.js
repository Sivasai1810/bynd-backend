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
    console.error(" Figma layers fetch error:", err.message);
    return [];
  }
}

// === Generate Previews ===
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
    console.error(" Image preview error:", err);
    return null;
  }
}

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

    //  Normalize Design Type
    let normalizedType = design_type.trim().toLowerCase();
    if (["image", "png", "jpeg", "jpg"].includes(normalizedType))
      normalizedType = "pdf"; // satisfies DB constraint

    if (!["figma", "pdf"].includes(normalizedType)) {
      return res.status(400).json({
        error: `Invalid design_type: ${design_type}. Must be 'figma' or 'pdf'.`,
      });
    }

    //  Handle File Upload
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
        console.error(" File upload error:", error.message);
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
      embed_url: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    console.log(" Inserting:", submissionData);

    // Insert Submission
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

    console.log(` Submission stored for ${company_name} (${position})`);

    //  Generate Previews
    if (normalizedType === "figma" && original_url) {
      const layers = await fetchFigmaLayers(original_url);
      if (layers.length) {
        const firstLayer = layers[0];
        const previewPath = await generateImagePreview(
          Buffer.from([]),
          user_id,
          submission.id
        );
        await supabase_connect
          .from("design_submissions")
          .update({ preview_thumbnail: previewPath })
          .eq("id", submission.id);
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
    console.error(" Server error:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

export default router;
