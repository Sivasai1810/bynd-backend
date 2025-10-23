// import Dotenv from "dotenv";
// Dotenv.config();
// import express from "express";
// import { supabase_connect } from "../supabase/set-up.js";
// const router = express.Router();

// function generatePreviewUrl(figmaUrl, userId, companyName) {

//   const uniqueId = crypto.randomBytes(8).toString('hex');
  
 
//   const previewUrl = `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(figmaUrl)}&chrome=DOCUMENTATION&hide-ui=1`;
  
  
//   const shareableLink = `${process.env.BASE_URL || 'http://localhost:3000'}/preview/${uniqueId}`;
  
//   return {
//     previewUrl,      
//     shareableLink,   
//     uniqueId         
//   };
// }

// router.post('', verifyToken, async (req, res) => {
//   try {
//     const user_id = req.user;

//     const { pasted_url, companyname, position, status, created_at } = req.body;

//     // Validate required fields
//     if (!pasted_url || !companyname || !position) {
//       return res.status(400).json({ 
//         error: "Missing required fields: pasted_url, companyname, or position" 
//       });
//     }

//     // Validate Figma URL
//     if (!pasted_url.includes('figma.com')) {
//       return res.status(400).json({ 
//         error: "Invalid Figma URL. Please provide a valid Figma link." 
//       });
//     }

//     // Generate preview URLs
//     const { previewUrl, shareableLink, uniqueId } = generatePreviewUrl(
//       pasted_url, 
//       user_id, 
//       companyname
//     );

//     console.log("Generated Preview URL:", previewUrl);
//     console.log("Generated Shareable Link:", shareableLink);

//     // Check if user already exists in database
//     const { data: existingUser, error: fetchError } = await supabase_connect
//       .from("user_urls")
//       .select("*")
//       .eq("user_id", user_id)
//       .single();

//     // Handle fetch errors (except "not found" error)
//     if (fetchError && fetchError.code !== 'PGRST116') {
//       console.log('Supabase fetch error:', fetchError.message);
//       return res.status(500).json({ error: fetchError.message });
//     }

//     if (existingUser) {
//       // USER EXISTS → Append new data to existing arrays
//       console.log("User found, appending data to arrays...");

//       const { data, error } = await supabase_connect
//         .from("user_urls")
//         .update({
//           pasted_url: [...(existingUser.pasted_url || []), pasted_url],
//           companyname: [...(existingUser.companyname || []), companyname],
//           position: [...(existingUser.position || []), position],
//           status: [...(existingUser.status || []), status],
//           preview_url: [...(existingUser.preview_url || []), previewUrl],
//           shareable_link: [...(existingUser.shareable_link || []), shareableLink],
//           unique_id: [...(existingUser.unique_id || []), uniqueId],
//           created_at: [...(existingUser.created_at || []), created_at || new Date().toISOString()]
//         })
//         .eq("user_id", user_id)
//         .select();

//       if (error) {
//         console.error("Update error:", error.message);
//         return res.status(500).json({ error: error.message });
//       }

//       console.log("Data appended successfully:", data);
//       return res.status(200).json({ 
//         message: "Data added to existing user", 
//         data,
//         previewUrl,
//         shareableLink
//       });

//     } else {
//       // USER DOES NOT EXIST → Create new user with arrays
//       console.log("User not found, creating new user...");

//       const { data, error } = await supabase_connect
//         .from("user_urls")
//         .insert([{
//           user_id,
//           pasted_url: [pasted_url],
//           companyname: [companyname],
//           position: [position],
//           status: [status],
//           preview_url: [previewUrl],
//           shareable_link: [shareableLink],
//           unique_id: [uniqueId],
//           created_at: [created_at || new Date().toISOString()]
//         }])
//         .select();

//       if (error) {
//         console.error("Insert error:", error.message);
//         return res.status(500).json({ error: error.message });
//       }

//       console.log("New user created successfully:", data);
//       return res.status(201).json({ 
//         message: "New user created with data", 
//         data,
//         previewUrl,
//         shareableLink
//       });
//     }

//   } catch (err) {
//     console.error("Server error:", err);
//     res.status(500).json({ error: "Server error occurred" });
//   }
// });

// export default router;

import express from "express";
import { supabase_connect } from "../supabase/set-up.js";
import multer from "multer";
import puppeteer from "puppeteer";
import sharp from "sharp"; // For image optimization

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

// Generate URLs
function generateUrls(figmaUrl, uniqueId) {
  const embedUrl = figmaUrl 
    ? `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(figmaUrl)}&chrome=DOCUMENTATION&hide-ui=1`
    : null;
  
  const shareableLink = `${process.env.BASE_URL || 'http://localhost:3000'}/view/${uniqueId}`;
  
  return { embedUrl, shareableLink };
}

// Generate preview screenshot (async, non-blocking)
async function generatePreviewScreenshot(embedUrl, uniqueId, userId) {
  let browser;
  try {
    console.log(`Generating preview for ${uniqueId}...`);
    
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
    
    // Set viewport for consistent screenshots
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Navigate to Figma embed
    await page.goto(embedUrl, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    // Wait a bit for Figma to render
    await page.waitForTimeout(3000);
    
    // Take screenshot
    const screenshot = await page.screenshot({ 
      type: 'jpeg',
      quality: 85,
      fullPage: false
    });
    
    // Optimize image with sharp (reduce size by ~60%)
    const optimizedImage = await sharp(screenshot)
      .resize(1920, 1080, { fit: 'cover' })
      .jpeg({ quality: 80, progressive: true })
      .toBuffer();
    
    // Upload to Supabase Storage
    const fileName = `${userId}/${uniqueId}_preview.jpg`;
    const { data: uploadData, error: uploadError } = await supabase_connect.storage
      .from('design_previews')
      .upload(fileName, optimizedImage, {
        contentType: 'image/jpeg',
        cacheControl: '3600',
        upsert: false
      });
    
    if (uploadError) {
      console.error("Preview upload error:", uploadError);
      return null;
    }
    
    console.log(`Preview generated successfully: ${fileName}`);
    
    // Get public URL
    const { data: publicUrlData } = supabase_connect.storage
      .from('design_previews')
      .getPublicUrl(fileName);
    
    // Update database with preview URL
    await supabase_connect
      .from("design_submissions")
      .update({ preview_thumbnail: publicUrlData.publicUrl })
      .eq('unique_id', uniqueId);
    
    return publicUrlData.publicUrl;
    
  } catch (error) {
    console.error("Screenshot generation error:", error);
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

    console.log("Received data:", { 
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
      
      const { data: uploadData, error: uploadError } = await supabase_connect.storage
        .from('design_files')
        .upload(fileName, req.file.buffer, {
          contentType: 'application/pdf',
          upsert: false
        });

      if (uploadError) {
        console.error("PDF upload error:", uploadError);
        return res.status(500).json({ 
          error: "Failed to upload PDF file",
          details: uploadError.message 
        });
      }

      pdf_file_path = uploadData.path;
      console.log("PDF uploaded successfully:", pdf_file_path);
    }

    // Generate embed_url and shareable_link
    const { embedUrl, shareableLink } = generateUrls(original_url, unique_id);

    console.log("Generated URLs:", { embedUrl, shareableLink });

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
      embed_url: embedUrl,
      preview_thumbnail: null, // Will be updated async
      created_at: new Date().toISOString()
    };

    console.log("Inserting submission data:", submissionData);

    // Insert into design_submissions table
    const { data: submission, error: insertError } = await supabase_connect
      .from("design_submissions")
      .insert([submissionData])
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      
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

    console.log("Submission stored successfully:", submission);

    // Generate preview screenshot asynchronously (don't block response)
    if (design_type === 'figma' && embedUrl) {
      generatePreviewScreenshot(embedUrl, unique_id, user_id)
        .then(() => console.log(`Preview generated for ${unique_id}`))
        .catch(err => console.error(`Preview generation failed for ${unique_id}:`, err));
    }

    // Return success response immediately
    return res.status(201).json({ 
      success: true,
      message: "Design submission created successfully", 
      submission,
      shareable_link: shareableLink,
      embed_url: embedUrl
    });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ 
      error: "Server error occurred",
      details: err.message 
    });
  }
});

export default router;