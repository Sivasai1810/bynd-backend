
import express from "express";
import { supabase_connect } from "../supabase/set-up.js";

const router = express.Router();

// Helper function to list all files in a folder
async function listFilesInFolder(bucket, folderPath) {
  try {
    const { data, error } = await supabase_connect.storage
      .from(bucket)
      .list(folderPath, {
        limit: 1000,
        sortBy: { column: 'name', order: 'asc' }
      });

    if (error) {
      console.error(`Error listing files in ${folderPath}:`, error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error(`Exception listing files in ${folderPath}:`, err);
    return [];
  }
}

// Helper function to delete an entire folder recursively
async function deleteFolderRecursively(bucket, folderPath) {
  try {
    // List all files in the folder
    const files = await listFilesInFolder(bucket, folderPath);
    
    if (files.length === 0) {
      console.log(` No files found in ${folderPath}`);
      return { success: true, deletedCount: 0 };
    }

    // Build full paths for all files
    const filePaths = files.map(file => `${folderPath}/${file.name}`);
    
    console.log(`  Deleting ${filePaths.length} files from ${bucket}/${folderPath}`);

    // Delete all files
    const { data, error } = await supabase_connect.storage
      .from(bucket)
      .remove(filePaths);

    if (error) {
      console.error(` Error deleting files from ${folderPath}:`, error);
      return { success: false, error };
    }

    console.log(` Deleted ${filePaths.length} files from ${bucket}/${folderPath}`);
    return { success: true, deletedCount: filePaths.length };
  } catch (err) {
    console.error(` Exception during folder deletion for ${folderPath}:`, err);
    return { success: false, error: err };
  }
}

// DELETE /submissions/delete/:uniqueId
router.delete('/delete/:uniqueId', async (req, res) => {
  try {
    const { uniqueId } = req.params;
    
    console.log(' Delete request - Unique ID:', uniqueId);

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
      console.error(" Fetch error:", fetchError.message);
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

    console.log(` Found submission to delete:`, {
      id: submission.id,
      unique_id: submission.unique_id,
      company: submission.company_name,
      type: submission.design_type,
      user_id: submission.user_id
    });

    // Delete associated layers from database first
    if (submission.id) {
      try {
        const { data: deletedLayers, error: layersError } = await supabase_connect
          .from("design_layers")
          .delete()
          .eq('submission_id', submission.id)
          .select();

        if (layersError) {
          console.error("  Error deleting layers:", layersError);
        } else {
          console.log(`  Deleted ${deletedLayers?.length || 0} layer records from database`);
        }
      } catch (layerErr) {
        console.error("  Exception during layer deletion:", layerErr);
      }
    }

    // Delete the entire submission folder from design_previews
    if (submission.user_id && submission.id) {
      const previewFolderPath = `${submission.user_id}/${submission.id}`;
      console.log(`  Deleting preview folder: ${previewFolderPath}`);
      
      const previewResult = await deleteFolderRecursively('design_previews', previewFolderPath);
      
      if (previewResult.success) {
        console.log(`Preview folder deleted: ${previewResult.deletedCount} files removed`);
      } else {
        console.error(`  Preview folder deletion had issues`);
      }
    }

    // Delete PDF file from design_files (if exists)
    if (submission.design_type === 'pdf' && submission.pdf_file_path) {
      try {
        const { error: deleteFileError } = await supabase_connect.storage
          .from('design_files')
          .remove([submission.pdf_file_path]);
        
        if (deleteFileError) {
          console.error("  PDF file deletion error:", deleteFileError);
        } else {
          console.log(` Deleted PDF file: ${submission.pdf_file_path}`);
        }
      } catch (fileErr) {
        console.error("  Exception during PDF file deletion:", fileErr);
      }
    }

    // Alternative: Delete entire folder from design_files if needed
    if (submission.user_id && submission.id) {
      const filesFolderPath = `${submission.user_id}/${submission.id}`;
      // console.log(` Checking design_files folder: ${filesFolderPath}`);
      
      const filesResult = await deleteFolderRecursively('design_files', filesFolderPath);
      
      if (filesResult.success && filesResult.deletedCount > 0) {
        // console.log(` Design files folder deleted: ${filesResult.deletedCount} files removed`);
      }
    }

    // Delete the submission from database using unique_id
    const { error: deleteError } = await supabase_connect
      .from("design_submissions")
      .delete()
      .eq('unique_id', uniqueId);

    if (deleteError) {
      console.error(" Database deletion error:", deleteError.message);
      return res.status(500).json({ 
        success: false,
        error: "Failed to delete submission from database",
        details: deleteError.message 
      });
    }

    // console.log(`Successfully deleted submission with unique_id: ${uniqueId}`);

    return res.status(200).json({ 
      success: true,
      message: "Submission and all associated files deleted successfully",
      deletedUniqueId: uniqueId,
      deletedData: {
        company_name: submission.company_name,
        position: submission.position,
        design_type: submission.design_type
      }
    });

  } catch (err) {
    console.error(" Server error during deletion:", err);
    return res.status(500).json({ 
      success: false,
      error: "Server error occurred during deletion",
      details: err.message 
    });
  }
});

export default router;