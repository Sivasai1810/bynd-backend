import express from "express";
import { supabase_connect } from "../supabase/set-up.js";

const router = express.Router();

// DELETE /submissions/delete/:uniqueId
router.delete('/delete/:uniqueId', async (req, res) => {
  try {
    const { uniqueId } = req.params;
    
    console.log('Delete request - Unique ID:', uniqueId);

    // Validate required fields
    if (!uniqueId) {
      return res.status(400).json({ 
        success: false,
        error: "Missing unique ID" 
      });
    }

    // Fetch the submission by unique_id
    const { data: submission, error: fetchError } = await supabase_connect
      .from("design_submissions")
      .select("*")
      .eq('unique_id', uniqueId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return res.status(404).json({ 
          success: false,
          error: "Submission not found" 
        });
      }
      console.error("Fetch error:", fetchError.message);
      return res.status(500).json({ 
        success: false,
        error: "Database error while fetching submission",
        details: fetchError.message 
      });
    }

    if (!submission) {
      return res.status(404).json({ 
        success: false,
        error: "Submission not found" 
      });
    }

    console.log(`Found submission to delete:`, {
      unique_id: submission.unique_id,
      company: submission.company_name,
      type: submission.design_type
    });

    // Delete associated PDF file from storage (if exists)
    if (submission.design_type === 'pdf' && submission.pdf_file_path) {
      try {
        const { error: deleteFileError } = await supabase_connect.storage
          .from('design_files')
          .remove([submission.pdf_file_path]);
        
        if (deleteFileError) {
          console.error("PDF file deletion error:", deleteFileError);
        } else {
          console.log(`✅ Deleted PDF file: ${submission.pdf_file_path}`);
        }
      } catch (fileErr) {
        console.error("Exception during PDF file deletion:", fileErr);
      }
    }

    // Delete thumbnail if exists
    if (submission.preview_thumbnail) {
      try {
        let thumbnailPath = submission.preview_thumbnail;
        if (thumbnailPath.includes('design_files/')) {
          thumbnailPath = thumbnailPath.split('design_files/')[1].split('?')[0];
        }
        
        const { error: deleteThumbnailError } = await supabase_connect.storage
          .from('design_files')
          .remove([thumbnailPath]);
        
        if (deleteThumbnailError) {
          console.error("Thumbnail deletion error:", deleteThumbnailError);
        } else {
          console.log(`✅ Deleted thumbnail: ${thumbnailPath}`);
        }
      } catch (thumbErr) {
        console.error("Exception during thumbnail deletion:", thumbErr);
      }
    }

    // Delete the submission from database using unique_id
    const { error: deleteError } = await supabase_connect
      .from("design_submissions")
      .delete()
      .eq('unique_id', uniqueId);

    if (deleteError) {
      console.error("Database deletion error:", deleteError.message);
      return res.status(500).json({ 
        success: false,
        error: "Failed to delete submission from database",
        details: deleteError.message 
      });
    }

    console.log(`✅ Successfully deleted submission with unique_id: ${uniqueId}`);

    return res.status(200).json({ 
      success: true,
      message: "Submission deleted successfully",
      deletedUniqueId: uniqueId,
      deletedData: {
        company_name: submission.company_name,
        position: submission.position,
        design_type: submission.design_type
      }
    });

  } catch (err) {
    console.error("Server error during deletion:", err);
    return res.status(500).json({ 
      success: false,
      error: "Server error occurred during deletion",
      details: err.message 
    });
  }
});

export default router;