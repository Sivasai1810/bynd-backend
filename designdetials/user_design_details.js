import dotenv from 'dotenv'
dotenv.config()
import express from "express";
import { supabase_connect } from "../supabase/set-up.js";
import multer from "multer";
import puppeteer from "puppeteer";
import sharp from "sharp";
import axios from "axios";
import pLimit from "p-limit";
import http from "http";
import https from "https";
import { PDFDocument } from "pdf-lib"; 

const router = express.Router();

// HTTP Agents for axios pooling
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });
const axiosInstance = axios.create({ timeout: 30000, httpAgent, httpsAgent });

// Multer (memory)
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
const getCleanFigmaToken = () => {
  const token = process.env.FIGMA_ACCESS_TOKEN;
  
  if (!token) throw new Error("Missing FIGMA_ACCESS_TOKEN");
  return token.trim().replace(/[\r\n\t]/g, "");
};
// helpers
const extractFigmaFileKey = (url) => {
  const match = url.match(/figma\.com\/(file|design)\/([^/?]+)/);
  return match ? match[2] : null;
};

// ===== FIGMA HELPERS =====
async function fetchFigmaFile(fileKey) {
  const token = getCleanFigmaToken();

  try {
    const response = await axios.get(
      `https://api.figma.com/v1/files/${fileKey}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return response.data;

  } catch (err) {
    console.error("FIGMA API ERROR:", err.response?.data || err.message);
    throw new Error("Figma API request failed");
  }
}

async function fetchFigmaImages(fileKey, ids) {
  const token = getCleanFigmaToken();

  try {
    const res = await axios.get(
      `https://api.figma.com/v1/images/${fileKey}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          ids: ids.join(","),
          format: "png",
          scale: 2,
        },
      }
    );

    return res.data.images;

  } catch (err) {
    console.error("FIGMA IMAGE ERROR:", err.response?.data || err.message);
    throw new Error("Figma image fetch failed");
  }
}

function extractFigmaFrames(figmaFile) {
  const frames = [];

  function walk(node) {
    if (node.type === "FRAME") {
      frames.push({
        id: node.id,
        name: node.name,
      });
    }

    if (node.children) {
      node.children.forEach(walk);
    }
  }

  figmaFile.document.children.forEach(page => {
    page.children?.forEach(walk);
  });

  return frames;
}


const generateShareableLink = (uniqueId) =>
  `https://bynd-final.vercel.app/recruiterview/${uniqueId}`;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));


async function prepareImageForPdf(imageBuffer, maxWidth = 1500) {
  // load via sharp, resize to maxWidth, keep aspect ratio, high quality
  const image = sharp(imageBuffer).rotate(); // auto-rotate from EXIF
  const metadata = await image.metadata();

  // only resize if wider than maxWidth
  if (metadata.width && metadata.width > maxWidth) {
    return await image
      .resize({ width: maxWidth, withoutEnlargement: true })
      .png({ quality: 90, compressionLevel: 6 })
      .toBuffer();
  } else {
    // still convert to PNG for embed consistency (pdf-lib embedPng handles transparency)
    return await image.png({ quality: 90, compressionLevel: 6 }).toBuffer();
  }
}


async function mergeFilesToSinglePdfBuffer(files) {
  // files: array of { buffer, mimetype, originalname }
  const mergedPdf = await PDFDocument.create();

  for (const file of files) {
    try {
      if (file.mimetype === "application/pdf") {
      
        const srcPdf = await PDFDocument.load(file.buffer);
        const copiedPages = await mergedPdf.copyPages(srcPdf, srcPdf.getPageIndices());
        copiedPages.forEach((p) => mergedPdf.addPage(p));
      } else if (file.mimetype.startsWith("image/")) {
      
        const preparedBuffer = await prepareImageForPdf(file.buffer, 1500);

        let embeddedImage;
      
        embeddedImage = await mergedPdf.embedPng(preparedBuffer);

        const { width, height } = embeddedImage.scale(1); 

      
        const page = mergedPdf.addPage([width, height]);
        page.drawImage(embeddedImage, {
          x: 0,
          y: 0,
          width,
          height,
        });
      } else {
    
        console.warn("Skipping unknown mimetype during merge:", file.mimetype);
      }
    } catch (err) {
      console.error("Error processing file for merge:", file.originalname, err?.message || err);
   
    }
  }

  const mergedBytes = await mergedPdf.save();
  return mergedBytes;
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
    await delay(1500);

    const screenshot = await page.screenshot({ type: "png" });

    const optimized = await sharp(screenshot).resize(2560, null).png().toBuffer();
    const filePath = `${userId}/${submissionId}/preview.png`;

    await supabase_connect.storage
      .from("design_previews")
      .upload(filePath, optimized, {
        contentType: "image/png",
        upsert: true,
      });

    return filePath;
  } catch (err) {
    console.error("generatePdfPreview error:", err?.message || err);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

router.post(
  "",
  upload.array("pdf_files", 30),
  async (req, res) => {


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
      normalizedType = "pdf"; // treat images uploads as pdf flow (merged final pdf)

    if (!["figma", "pdf"].includes(normalizedType)) {
      return res.status(400).json({ error: "Invalid design_type" });
    }

    
    let file_path = null;

  
    if (req.files && req.files.length > 0 && normalizedType === "pdf") {
  
      const filesArray = req.files.map((f) => ({
        buffer: f.buffer,
        mimetype: f.mimetype,
        originalname: f.originalname,
      }));

     
      const mergedPdfBuffer = await mergeFilesToSinglePdfBuffer(filesArray);

   
      const fileName = `${user_id}/${unique_id}/document.pdf`;
      const { data, error } = await supabase_connect.storage
  .from("design_files")
  .upload(fileName, mergedPdfBuffer, {
    contentType: "application/pdf",
    upsert: true,
    metadata: {
      contentDisposition: "inline",
    },
  });


      if (error) {
        console.error("Supabase upload error:", error.message || error);
        return res.status(500).json({ error: "Failed to upload merged PDF", details: error.message });
      }

      file_path = data.path;
    }


    const shareableLink = generateShareableLink(unique_id);

   
    const submissionPayload = {
      user_id,
      unique_id,
      design_type: normalizedType,
      original_url: normalizedType === "figma" ? original_url || null : null,
      pdf_file_path: file_path,
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
      .insert([submissionPayload])
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return res.status(500).json({ error: "DB insert failed", details: insertError.message });
    }

    // If merged PDF present, generate preview from it
    if (file_path && normalizedType === "pdf") {
      const previewPath = await generatePdfPreview(file_path, user_id, submission.id);
      if (previewPath) {
        await supabase_connect
          .from("design_submissions")
          .update({ preview_thumbnail: previewPath })
          .eq("id", submission.id);
      }
    }

    // If figma flow, keep original figma handling if needed (layers etc.)
   if (normalizedType === "figma" && original_url) {
  const fileKey = extractFigmaFileKey(original_url);
  if (!fileKey) {
    return res.status(400).json({ error: "Invalid Figma URL" });
  }


  const figmaFile = await fetchFigmaFile(fileKey);

  
  const frames = extractFigmaFrames(figmaFile);
  if (!frames.length) return;

  
  const imageMap = await fetchFigmaImages(
    fileKey,
    frames.map(f => f.id)
  );


  let order = 0;

  for (const frame of frames) {
    const previewUrl = imageMap[frame.id];
    if (!previewUrl) continue;

    await supabase_connect
      .from("design_layers")
      .insert({
        submission_id: submission.id,
        user_id,
        layer_name: frame.name,
        layer_order: order++,
        layer_preview_url: previewUrl,
        layer_embed_url: null, // optional for future
      });
  }
}


    return res.status(201).json({
      success: true,
      message: "Design submission created successfully",
      shareable_link: shareableLink,
      submission,
    });
  } catch (err) {
    console.error("Server error:", err?.message || err);
    return res.status(500).json({ error: "Server error", details: err?.message || err });
  }
});

export default router;
