// import dotenv from 'dotenv'
// dotenv.config()
// import express from "express";
// import { Resend } from "resend"
// import { supabase_connect } from "../supabase/set-up.js";
// const router = express.Router();
// const resend = new Resend(process.env.RESEND_TOKEN)

// router.post("/:uniqueId", async (req, res) => {
//   console.log("Incoming request successfully")
//   try {
//     const { uniqueId } = req.params;
//     const { data: existingNotification } =
//       await supabase_connect
//         .from("notifications")
//         .select("*")
//         .eq("submission_id", uniqueId)
//         .single();

  
//     const { data: submission } =
//       await supabase_connect
//         .from("design_submissions")
//         .select("*")
//         .eq("unique_id", uniqueId)
//         .single();

//     if (!submission) {
//       return res.status(400).json({ error: "Submission not found" });
//     }

//     if (existingNotification) {
   
//       await supabase_connect
//         .from("notifications")
//         .update({ last_viewed_at: new Date() })
//         .eq("submission_id", uniqueId);
//     } else {
    
//       await supabase_connect
//         .from("notifications")
//         .insert([{
//           user_id: submission.user_id,
//           submission_id: uniqueId,
//           company_name: submission.company_name,
//           position_name: submission.position,
//           last_viewed_at: new Date(),
//           is_read: false,
//         }]);
//     }


//     const { data: authUser } =
//       await supabase_connect.auth.admin.getUserById(
//         submission.user_id
//       );

//     if (!authUser?.user?.email) {
//       console.log("Designer email not found");
//       return res.status(200).json({ success: true });
//     }

//     const designerEmail = authUser.user.email;
   
//     // const mailRes = await transporter.sendMail({
//     //   from: `"BYND" <${process.env.EMAIL_USER}>`,
//     //   to: designerEmail,
//     //   subject: `${submission.company_name} viewed your assignment`,
//     //   html: `
//     //     <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto;">
//     //       <p>
//     //         Your assignment has been viewed by
//     //         <strong>${submission.company_name}</strong>
//     //         for the position of
//     //         <strong>${submission.position}</strong>.
//     //       </p>

//     //       <p style="color:#374151;">
//     //         You can check detailed analytics such as views and engagement from your dashboard.
//     //       </p>

//     //       <p style="font-size:12px;color:#6b7280;">
//     //         ${new Date().toLocaleString("en-IN")}
//     //       </p>

//     //       <p>
//     //         Best regards,<br/>
//     //         <strong>BYND Team</strong>
//     //       </p>
//     //     </div>
//     //   `
//     // });
// const { data, error } =await resend.emails.send({
// // from:`"BYND" <${process.env.EMAIL_USER}>`,
// from: "BYND <onboarding@resend.dev>",
// to:designerEmail,
// subject:`${submission.company_name} viewed your assignment`,
//  html: `
//         <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto;">
//           <p>
//             Your assignment has been viewed by
//             <strong>${submission.company_name}</strong>
//             for the position of
//             <strong>${submission.position}</strong>.
//           </p>

//           <p style="color:#374151;">
//             You can check detailed analytics such as views and engagement from your dashboard.
//           </p>

//           <p style="font-size:12px;color:#6b7280;">
//             ${new Date().toLocaleString("en-IN")}
//           </p>

//           <p>
//             Best regards,<br/>
//             <strong>BYND Team</strong>
//           </p>
//         </div>`
//  })
//     if(error){
//       console.log("Email failed :",error)
//     }else{
//       console.log("Email sent successfully",data.id)
//     }

//     return res.status(200).json({
//       success: true,
//       message: "Notification processed and email sent",
//     });

//   } catch (err) {
//     console.error("ERROR:", err);
//     return res.status(500).json({ error: err.message });
//   }
// });


// export default router;

