// import express from "express";
// import { supabase_connect } from "../supabase/set-up.js";
// import multer from "multer";
// import puppeteer from "puppeteer";
// import sharp from "sharp"; // For image optimization

// const router = express.Router();

// // Configure multer for PDF uploads
// const storage = multer.memoryStorage();
// const upload = multer({
//   storage: storage,
//   limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
//   fileFilter: (req, file, cb) => {
//     if (file.mimetype === 'application/pdf') {
//       cb(null, true);
//     } else {
//       cb(new Error('Only PDF files are allowed'));
//     }
//   }
// });

// // Generate URLs
// function generateUrls(figmaUrl, uniqueId) {
//   const embedUrl = figmaUrl 
//     ? `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(figmaUrl)}&chrome=DOCUMENTATION&hide-ui=1`
//     : null;
  
//   // const shareableLink = `https://bynd-backend.onrender.com/BYNDLINK/view/${uniqueId}`;
//   const shareableLink = `http://localhost:3000/BYNDLINK/view/${uniqueId}`;
//   return { embedUrl, shareableLink };
// }

// // Generate preview screenshot (async, non-blocking)
// async function generatePreviewScreenshot(embedUrl, uniqueId, userId) {
//   let browser;
//   try {
//     console.log(`Generating preview for ${uniqueId}...`);
    
//     browser = await puppeteer.launch({
//       headless: 'new',
//       args: [
//         '--no-sandbox',
//         '--disable-setuid-sandbox',
//         '--disable-dev-shm-usage',
//         '--disable-accelerated-2d-canvas',
//         '--disable-gpu'
//       ]
//     });
    
//     const page = await browser.newPage();
    
//     // Set viewport for consistent screenshots
//     await page.setViewport({ width: 1920, height: 1080 });
    
//     // Navigate to Figma embed
//     await page.goto(embedUrl, { 
//       waitUntil: 'networkidle2',
//       timeout: 30000 
//     });
    
//     // Wait a bit for Figma to render
//   await page.waitForTimeout(3000);
    
//     // Take screenshot
//     const screenshot = await page.screenshot({ 
//       type: 'jpeg',
//       quality: 85,
//       fullPage: false
//     });
    
//     // Optimize image with sharp (reduce size by ~60%)
//     const optimizedImage = await sharp(screenshot)
//       .resize(1920, 1080, { fit: 'cover' })
//       .jpeg({ quality: 80, progressive: true })
//       .toBuffer();
    
//     // Upload to Supabase Storage
//     const fileName = `${userId}/${uniqueId}_preview.jpg`;
//     const { data: uploadData, error: uploadError } = await supabase_connect.storage
//       .from('design_previews')
//       .upload(fileName, optimizedImage, {
//         contentType: 'image/jpeg',
//         cacheControl: '3600',
//         upsert: false
//       });
    
//     if (uploadError) {
//       console.error("Preview upload error:", uploadError);
//       return null;
//     }
    
//     console.log(`Preview generated successfully: ${fileName}`);
    
//     // Get public URL
//     const { data: publicUrlData } = supabase_connect.storage
//       .from('design_previews')
//       .getPublicUrl(fileName);
    
//     // Update database with preview URL
//     await supabase_connect
//       .from("design_submissions")
//       .update({ preview_thumbnail: publicUrlData.publicUrl })
//       .eq('unique_id', uniqueId);
    
//     return publicUrlData.publicUrl;
    
//   } catch (error) {
//     console.error("Screenshot generation error:", error);
//     return null;
//   } finally {
//     if (browser) await browser.close();
//   }
// }

// // POST route to store design submission
// router.post('', upload.single('pdf_file'), async (req, res) => {
//   try {
//     const { 
//       user_id,
//       unique_id,
//       design_type,
//       original_url,
//       company_name,
//       position,
//       status = 'pending'
//     } = req.body;

//     console.log("Received data:", { 
//       user_id, 
//       unique_id, 
//       design_type, 
//       original_url, 
//       company_name, 
//       position 
//     });

//     // Validate required fields
//     if (!unique_id || !design_type || !company_name || !position) {
//       return res.status(400).json({ 
//         error: "Missing required fields: unique_id, design_type, company_name, or position" 
//       });
//     }

//     // Validate design_type
//     if (!['figma', 'pdf'].includes(design_type)) {
//       return res.status(400).json({ 
//         error: "Invalid design_type. Must be 'figma' or 'pdf'" 
//       });
//     }

//     // Validate based on design_type
//     if (design_type === 'figma') {
//       if (!original_url) {
//         return res.status(400).json({ 
//           error: "original_url is required for Figma designs" 
//         });
//       }
//       if (!original_url.includes('figma.com')) {
//         return res.status(400).json({ 
//           error: "Invalid Figma URL. Please provide a valid Figma link." 
//         });
//       }
//     }

//     if (design_type === 'pdf' && !req.file) {
//       return res.status(400).json({ 
//         error: "PDF file is required for PDF design submissions" 
//       });
//     }

//     // Handle PDF upload to Supabase Storage
//     let pdf_file_path = null;
//     if (design_type === 'pdf' && req.file) {
//       const fileName = `${user_id}/${unique_id}.pdf`;
      
//       const { data: uploadData, error: uploadError } = await supabase_connect.storage
//         .from('design_files')
//         .upload(fileName, req.file.buffer, {
//           contentType: 'application/pdf',
//           upsert: false
//         });

//       if (uploadError) {
//         console.error("PDF upload error:", uploadError);
//         return res.status(500).json({ 
//           error: "Failed to upload PDF file",
//           details: uploadError.message 
//         });
//       }

//       pdf_file_path = uploadData.path;
//       console.log("PDF uploaded successfully:", pdf_file_path);
//     }

//     // Generate embed_url and shareable_link
//     const { embedUrl, shareableLink } = generateUrls(original_url, unique_id);

//     console.log("Generated URLs:", { embedUrl, shareableLink });

//     // Prepare data for insertion
//     const submissionData = {
//       user_id,
//       unique_id,
//       design_type,
//       original_url: design_type === 'figma' ? original_url : null,
//       pdf_file_path: design_type === 'pdf' ? pdf_file_path : null,
//       company_name,
//       position,
//       status,
//       shareable_link: shareableLink,
//       embed_url: embedUrl,
//       preview_thumbnail: null, // Will be updated async
//       created_at: new Date().toISOString()
//     };

//     console.log("Inserting submission data:", submissionData);

//     // Insert into design_submissions table
//     const { data: submission, error: insertError } = await supabase_connect
//       .from("design_submissions")
//       .insert([submissionData])
//       .select()
//       .single();

//     if (insertError) {
//       console.error("Insert error:", insertError);
      
//       // If insert failed and we uploaded a PDF, delete it
//       if (pdf_file_path) {
//         await supabase_connect.storage
//           .from('design_files')
//           .remove([pdf_file_path]);
//       }
      
//       return res.status(500).json({ 
//         error: "Failed to store submission",
//         details: insertError.message 
//       });
//     }

//     console.log("Submission stored successfully:", submission);

//     // Generate preview screenshot asynchronously (don't block response)
//     if (design_type === 'figma' && embedUrl) {
//       generatePreviewScreenshot(embedUrl, unique_id, user_id)
//         .then(() => console.log(`Preview generated for ${unique_id}`))
//         .catch(err => console.error(`Preview generation failed for ${unique_id}:`, err));
//     }

//     // Return success response immediately
//     return res.status(201).json({ 
//       success: true,
//       message: "Design submission created successfully", 
//       submission,
//       shareable_link: shareableLink,
//       embed_url: embedUrl
//     });

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
import multer from "multer";
import puppeteer from "puppeteer";
import sharp from "sharp";

const router = express.Router();

// Configure multer for PDF uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

// Generate URLs - SEPARATE for PDF and Figma
function generateUrls(figmaUrl, uniqueId, designType) {
  let embedUrl = null;
  let shareableLink = '';

  if (designType === 'figma') {
    // Figma embed URL
    embedUrl = `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(figmaUrl)}&chrome=DOCUMENTATION&hide-ui=1`;
    // Figma shareable link (goes to main preview route)
    // shareableLink = `http://localhost:3000/BYNDLINK/view/${uniqueId}`;
    // https://bynd-backend.onrender.com
    shareableLink = `https://bynd-backend.onrender.com/BYNDLINK/view/${uniqueId}`;

  } else if (designType === 'pdf') {
    // PDF embed URL is null (not used directly)
    embedUrl = null;
    // PDF shareable link (goes to PDF-specific preview route)
  //  shareableLink = `http://localhost:3000/BYNDLINK/view/pdf-viewer/${uniqueId}`;
  shareableLink = `https://bynd-backend.onrender.com/BYNDLINK/view/pdf-viewer/${uniqueId}`;
  }

  return { embedUrl, shareableLink };
}

// Generate preview screenshot for Figma (async, non-blocking)
async function generatePreviewScreenshot(embedUrl, uniqueId, userId) {
  let browser;
  try {
    console.log(` Generating preview for ${uniqueId}...`);
    
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    await page.goto(embedUrl, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    // Wait for Figma to render
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const screenshot = await page.screenshot({ 
      type: 'jpeg',
      quality: 85,
      fullPage: false
    });
    
    const optimizedImage = await sharp(screenshot)
      .resize(1920, 1080, { fit: 'cover' })
      .jpeg({ quality: 80, progressive: true })
      .toBuffer();
    
    const fileName = `${userId}/${uniqueId}_preview.jpg`;
    const { data: uploadData, error: uploadError } = await supabase_connect.storage
      .from('design_previews')
      .upload(fileName, optimizedImage, {
        contentType: 'image/jpeg',
        cacheControl: '3600',
        upsert: false
      });
    
    if (uploadError) {
      console.error(" Preview upload error:", uploadError);
      return null;
    }
    
    console.log(`Preview generated: ${fileName}`);
    
    const { data: publicUrlData } = supabase_connect.storage
      .from('design_previews')
      .getPublicUrl(fileName);
    
    await supabase_connect
      .from("design_submissions")
      .update({ preview_thumbnail: publicUrlData.publicUrl })
      .eq('unique_id', uniqueId);
    
    return publicUrlData.publicUrl;
    
  } catch (error) {
    console.error(" Screenshot generation error:", error);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// Generate preview thumbnail for PDF (first page as image)
async function generatePdfPreview(pdfPath, uniqueId, userId) {
  let browser;
  try {
    console.log(`Generating PDF preview for ${uniqueId}...`);

    // Get signed URL for PDF
    const { data: signedUrlData, error: signedUrlError } = await supabase_connect.storage
      .from('design_files')
      .createSignedUrl(pdfPath, 300); // 5 min validity, just for preview generation

    if (signedUrlError) {
      console.error(" Signed URL error:", signedUrlError);
      return null;
    }

    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Navigate to PDF
    await page.goto(signedUrlData.signedUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for PDF to load
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Take screenshot of first page
    const screenshot = await page.screenshot({
      type: 'jpeg',
      quality: 85,
      fullPage: false
    });

    const optimizedImage = await sharp(screenshot)
      .resize(1920, 1080, { fit: 'cover' })
      .jpeg({ quality: 80, progressive: true })
      .toBuffer();

    const fileName = `${userId}/${uniqueId}_preview.jpg`;
    const { data: uploadData, error: uploadError } = await supabase_connect.storage
      .from('design_previews')
      .upload(fileName, optimizedImage, {
        contentType: 'image/jpeg',
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error(" PDF Preview upload error:", uploadError);
      return null;
    }

    console.log(`PDF Preview generated: ${fileName}`);

    const { data: publicUrlData } = supabase_connect.storage
      .from('design_previews')
      .getPublicUrl(fileName);

    await supabase_connect
      .from("design_submissions")
      .update({ preview_thumbnail: publicUrlData.publicUrl })
      .eq('unique_id', uniqueId);

    return publicUrlData.publicUrl;

  } catch (error) {
    console.error(" PDF preview generation error:", error);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// POST route to store design submission
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

    console.log(" Received data:", { 
      user_id, 
      unique_id, 
      design_type, 
      original_url, 
      company_name, 
      position 
    });

    // Validate required fields
    if (!unique_id || !design_type || !company_name || !position) {
      return res.status(400).json({ 
        error: "Missing required fields: unique_id, design_type, company_name, or position" 
      });
    }

    // Validate design_type
    if (!['figma', 'pdf'].includes(design_type)) {
      return res.status(400).json({ 
        error: "Invalid design_type. Must be 'figma' or 'pdf'" 
      });
    }

    // Validate based on design_type
    if (design_type === 'figma') {
      if (!original_url) {
        return res.status(400).json({ 
          error: "original_url is required for Figma designs" 
        });
      }
      if (!original_url.includes('figma.com')) {
        return res.status(400).json({ 
          error: "Invalid Figma URL. Please provide a valid Figma link." 
        });
      }
    }

    if (design_type === 'pdf' && !req.file) {
      return res.status(400).json({ 
        error: "PDF file is required for PDF design submissions" 
      });
    }

    // Handle PDF upload to Supabase Storage
    let pdf_file_path = null;
    if (design_type === 'pdf' && req.file) {
      const fileName = `${user_id}/${unique_id}.pdf`;
      
      console.log(` Uploading PDF: ${fileName}`);
      
      const { data: uploadData, error: uploadError } = await supabase_connect.storage
        .from('design_files')
        .upload(fileName, req.file.buffer, {
          contentType: 'application/pdf',
          upsert: false
        });

      if (uploadError) {
        console.error(" PDF upload error:", uploadError);
        return res.status(500).json({ 
          error: "Failed to upload PDF file",
          details: uploadError.message 
        });
      }

      pdf_file_path = uploadData.path;
      console.log(` PDF uploaded: ${pdf_file_path}`);
    }

    // Generate URLs - Pass design_type to generate appropriate URLs
    const { embedUrl, shareableLink } = generateUrls(original_url, unique_id, design_type);

    console.log("Generated URLs:", { 
      embedUrl: embedUrl || 'N/A (PDF)', 
      shareableLink,
      designType: design_type 
    });

    // Prepare data for insertion
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
      embed_url: embedUrl, // Will be null for PDF
      preview_thumbnail: null, // Will be updated async
      created_at: new Date().toISOString()
    };

    console.log(" Inserting submission...");

    // Insert into design_submissions table
    const { data: submission, error: insertError } = await supabase_connect
      .from("design_submissions")
      .insert([submissionData])
      .select()
      .single();

    if (insertError) {
      console.error(" Insert error:", insertError);
      
      // If insert failed and we uploaded a PDF, delete it
      if (pdf_file_path) {
        await supabase_connect.storage
          .from('design_files')
          .remove([pdf_file_path]);
      }
      
      return res.status(500).json({ 
        error: "Failed to store submission",
        details: insertError.message 
      });
    }

    console.log(" Submission stored successfully!");

    // Generate preview screenshot asynchronously (don't block response)
    if (design_type === 'figma' && embedUrl) {
      console.log(" Starting Figma preview generation...");
      generatePreviewScreenshot(embedUrl, unique_id, user_id)
        .then(() => console.log(`Figma preview generated for ${unique_id}`))
        .catch(err => console.error(` Figma preview generation failed for ${unique_id}:`, err));
    } else if (design_type === 'pdf' && pdf_file_path) {
      console.log(" Starting PDF preview generation...");
      generatePdfPreview(pdf_file_path, unique_id, user_id)
        .then(() => console.log(`PDF preview generated for ${unique_id}`))
        .catch(err => console.error(` PDF preview generation failed for ${unique_id}:`, err));
    }

    // Return success response immediately
    return res.status(201).json({ 
      success: true,
      message: "Design submission created successfully", 
      submission,
      shareable_link: shareableLink,
      embed_url: embedUrl,
      design_type: design_type
    });

  } catch (err) {
    console.error(" Server error:", err);
    res.status(500).json({ 
      error: "Server error occurred",
      details: err.message 
    });
  }
});

export default router;
