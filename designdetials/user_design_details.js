import Dotenv from "dotenv";
Dotenv.config();
import express from "express";
import { supabase_connect } from "../supabase/set-up.js";
import verifyToken from "../middlewares/verifytoken.js";
import crypto from "crypto";
const router = express.Router();

function generatePreviewUrl(figmaUrl, userId, companyName) {

  const uniqueId = crypto.randomBytes(8).toString('hex');
  
 
  const previewUrl = `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(figmaUrl)}&chrome=DOCUMENTATION&hide-ui=1`;
  
  
  const shareableLink = `${process.env.BASE_URL || 'http://localhost:3000'}/preview/${uniqueId}`;
  
  return {
    previewUrl,      
    shareableLink,   
    uniqueId         
  };
}

router.post('', verifyToken, async (req, res) => {
  try {
    const user_id = req.user;

    const { pasted_url, companyname, position, status, created_at } = req.body;

    // Validate required fields
    if (!pasted_url || !companyname || !position) {
      return res.status(400).json({ 
        error: "Missing required fields: pasted_url, companyname, or position" 
      });
    }

    // Validate Figma URL
    if (!pasted_url.includes('figma.com')) {
      return res.status(400).json({ 
        error: "Invalid Figma URL. Please provide a valid Figma link." 
      });
    }

    // Generate preview URLs
    const { previewUrl, shareableLink, uniqueId } = generatePreviewUrl(
      pasted_url, 
      user_id, 
      companyname
    );

    console.log("Generated Preview URL:", previewUrl);
    console.log("Generated Shareable Link:", shareableLink);

    // Check if user already exists in database
    const { data: existingUser, error: fetchError } = await supabase_connect
      .from("user_urls")
      .select("*")
      .eq("user_id", user_id)
      .single();

    // Handle fetch errors (except "not found" error)
    if (fetchError && fetchError.code !== 'PGRST116') {
      console.log('Supabase fetch error:', fetchError.message);
      return res.status(500).json({ error: fetchError.message });
    }

    if (existingUser) {
      // USER EXISTS → Append new data to existing arrays
      console.log("User found, appending data to arrays...");

      const { data, error } = await supabase_connect
        .from("user_urls")
        .update({
          pasted_url: [...(existingUser.pasted_url || []), pasted_url],
          companyname: [...(existingUser.companyname || []), companyname],
          position: [...(existingUser.position || []), position],
          status: [...(existingUser.status || []), status],
          preview_url: [...(existingUser.preview_url || []), previewUrl],
          shareable_link: [...(existingUser.shareable_link || []), shareableLink],
          unique_id: [...(existingUser.unique_id || []), uniqueId],
          created_at: [...(existingUser.created_at || []), created_at || new Date().toISOString()]
        })
        .eq("user_id", user_id)
        .select();

      if (error) {
        console.error("Update error:", error.message);
        return res.status(500).json({ error: error.message });
      }

      console.log("Data appended successfully:", data);
      return res.status(200).json({ 
        message: "Data added to existing user", 
        data,
        previewUrl,
        shareableLink
      });

    } else {
      // USER DOES NOT EXIST → Create new user with arrays
      console.log("User not found, creating new user...");

      const { data, error } = await supabase_connect
        .from("user_urls")
        .insert([{
          user_id,
          pasted_url: [pasted_url],
          companyname: [companyname],
          position: [position],
          status: [status],
          preview_url: [previewUrl],
          shareable_link: [shareableLink],
          unique_id: [uniqueId],
          created_at: [created_at || new Date().toISOString()]
        }])
        .select();

      if (error) {
        console.error("Insert error:", error.message);
        return res.status(500).json({ error: error.message });
      }

      console.log("New user created successfully:", data);
      return res.status(201).json({ 
        message: "New user created with data", 
        data,
        previewUrl,
        shareableLink
      });
    }

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Server error occurred" });
  }
});

export default router;