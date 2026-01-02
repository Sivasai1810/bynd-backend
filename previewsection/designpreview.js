// import express from "express";
// import { supabase_connect } from "../supabase/set-up.js";
// import { submissionsCache }from "../cache/submissionsCache.js"
// const router = express.Router();
// async function getAuthUser(req) {
//   try {
//     const authHeader = req.headers.authorization;
//     const token = authHeader?.startsWith("Bearer ")
//       ? authHeader.replace("Bearer ", "")
//       : null;

//     if (!token) return null;

//     const { data, error } = await supabase_connect.auth.getUser(token);
//     if (error) return null;

//     return data.user;
//   } catch {
//     return null;
//   }
// }

// router.get("/:uniqueId", async (req, res) => {
//   try {
//     const { uniqueId } = req.params;

//     /* ---------------- Fetch Design ---------------- */
//     const { data: design, error } = await supabase_connect
//       .from("design_submissions")
//       .select("*")
//       .eq("unique_id", uniqueId)
//       .single();

//     if (error || !design) {
//       return res.status(404).json({ error: "Design not found" });
//     }

//     /* ---------------- Update View Status ---------------- */
//     // await supabase_connect
//     //   .from("design_submissions")
//     //   .update({
//     //     last_viewed_at: new Date().toISOString(),
//     //     status: "viewed",
//     //   })
//     //   .eq("id", design.id);

//     const authUser = await getAuthUser(req);

// // viewer is owner (designer)
// const isOwner = authUser && authUser.id === design.user_id;

// if (!isOwner) {
//   await supabase_connect
//     .from("design_submissions")
//     .update({
//       last_viewed_at: new Date().toISOString(),
//       status: "viewed",
//     })
//     .eq("id", design.id);
// }

// submissionsCache.delete(submission.user_id);

//     /* ---------------- Fetch Layers (FIGMA) ---------------- */
//     let layers = [];

//     if (design.design_type === "figma") {
//       const { data: layerRows, error: layerError } =
//         await supabase_connect
//           .from("design_layers")
//           .select("*")
//           .eq("submission_id", design.id)
//           .order("layer_order", { ascending: true });

//       if (!layerError && layerRows?.length) {
//         for (let l of layerRows) {
//           const cleanName = l.layer_name.replace(/[^a-zA-Z0-9]/g, "_");
//           const path = `${design.user_id}/${design.id}/${cleanName}_${l.layer_order}.png`;

//           const { data: signed } = await supabase_connect.storage
//             .from("design_previews")
//             .createSignedUrl(path, 3600);

//           layers.push({
//             name: l.layer_name,
//             order: l.layer_order,
//             url: signed?.signedUrl || null,
//           });
//         }
//       }
//     }

//     /* ---------------- Thumbnail ---------------- */
//     let previewThumb = null;
//     if (design.preview_thumbnail) {
//       const { data: signed } = await supabase_connect.storage
//         .from("design_previews")
//         .createSignedUrl(design.preview_thumbnail, 3600);

//       previewThumb = signed?.signedUrl || null;
//     }

//     /* ---------------- PDF ---------------- */
//     let pdfUrl = null;

//     if (design.design_type === "pdf") {
//       const { data: signed, error: pdfError } =
//         await supabase_connect.storage
//           .from("design_files")
//           .createSignedUrl(design.pdf_file_path, 3600);

//       if (pdfError) {
//         return res.status(500).json({ error: "Failed to generate PDF URL" });
//       }

//       pdfUrl = `${signed.signedUrl}#toolbar=0&navpanes=0&scrollbar=0&statusbar=0&messages=0&view=FitH`;
//     }

//     /* ---------------- RESPONSE ---------------- */
//     res.json({
//       ok: true,
//       design,
//       previewThumb,
//       layers,
//       pdfUrl,
//     });
//   } catch (err) {
//     console.error("Preview route error:", err);
//     res.status(500).json({
//       error: "Server error",
//       details: err.message,
//     });
//   }
// });

// export default router;
import express from "express";
import { supabase_connect } from "../supabase/set-up.js";
import { submissionsCache } from "../cache/submissionsCache.js";

const router = express.Router();

async function getAuthUser(req) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.replace("Bearer ", "")
      : null;

    if (!token) return null;

    const { data, error } = await supabase_connect.auth.getUser(token);
    if (error) return null;

    return data.user;
  } catch {
    return null;
  }
}

router.get("/:uniqueId", async (req, res) => {
  try {
    const { uniqueId } = req.params;

    /* Fetch Design */
    const { data: design, error } = await supabase_connect
      .from("design_submissions")
      .select("*")
      .eq("unique_id", uniqueId)
      .single();

    if (error || !design) {
      return res.status(404).json({ error: "Design not found" });
    }

    /*Update view status */
    const authUser = await getAuthUser(req);

    // viewer is owner (designer)
    const isOwner = authUser && authUser.id === design.user_id;

    if (!isOwner) {
      await supabase_connect
        .from("design_submissions")
        .update({
          last_viewed_at: new Date().toISOString(),
          status: "viewed",
        })
        .eq("id", design.id);
    }

  
    submissionsCache.delete(design.user_id);

    /* Fetch layers (FIGMA)  */
    let layers = [];

    if (design.design_type === "figma") {
      const { data: layerRows, error: layerError } =
        await supabase_connect
          .from("design_layers")
          .select("*")
          .eq("submission_id", design.id)
          .order("layer_order", { ascending: true });

      if (!layerError && layerRows?.length) {
    
        layers = layerRows.map(l => ({
          name: l.layer_name,
          order: l.layer_order,
          url: l.layer_preview_url,
        }));
      }
    }


    let previewThumb = null;
    if (design.preview_thumbnail) {
      const { data: signed } = await supabase_connect.storage
        .from("design_previews")
        .createSignedUrl(design.preview_thumbnail, 3600);

      previewThumb = signed?.signedUrl || null;
    }

    /*  PDF  */
    let pdfUrl = null;

    if (design.design_type === "pdf") {
      const { data: signed, error: pdfError } =
        await supabase_connect.storage
          .from("design_files")
          .createSignedUrl(design.pdf_file_path, 3600);

      if (pdfError) {
        return res.status(500).json({ error: "Failed to generate PDF URL" });
      }

      pdfUrl = `${signed.signedUrl}#toolbar=0&navpanes=0&scrollbar=0&statusbar=0&messages=0&view=FitH`;
    }

    /*  RESPONSE  */
    res.json({
      ok: true,
      design,
      previewThumb,
      layers,
      pdfUrl,
    });
  } catch (err) {
    console.error("Preview route error:", err);
    res.status(500).json({
      error: "Server error",
      details: err.message,
    });
  }
});

export default router;