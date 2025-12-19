import dotenv from 'dotenv'
dotenv.config()
import express from "express";
import nodemailer from "nodemailer";
import { supabase_connect } from "../supabase/set-up.js";

const router = express.Router();


const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
router.post("/:uniqueId", async (req, res) => {



  try {
    const { uniqueId } = req.params;
  

    
    const { data: existingNotification } =
      await supabase_connect
        .from("notifications")
        .select("*")
        .eq("submission_id", uniqueId)
        .single();

  
    const { data: submission } =
      await supabase_connect
        .from("design_submissions")
        .select("*")
        .eq("unique_id", uniqueId)
        .single();

    if (!submission) {
      return res.status(400).json({ error: "Submission not found" });
    }

    if (existingNotification) {
   
      await supabase_connect
        .from("notifications")
        .update({ last_viewed_at: new Date() })
        .eq("submission_id", uniqueId);
    } else {
    
      await supabase_connect
        .from("notifications")
        .insert([{
          user_id: submission.user_id,
          submission_id: uniqueId,
          company_name: submission.company_name,
          position_name: submission.position,
          last_viewed_at: new Date(),
          is_read: false,
        }]);
    }


    const { data: authUser } =
      await supabase_connect.auth.admin.getUserById(
        submission.user_id
      );

    if (!authUser?.user?.email) {
      console.log("Designer email not found");
      return res.status(200).json({ success: true });
    }

    const designerEmail = authUser.user.email;
   
    const mailRes = await transporter.sendMail({
      from: `"BYND" <${process.env.EMAIL_USER}>`,
      to: designerEmail,
      subject: `${submission.company_name} viewed your assignment`,
      html: `
        <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto;">
          <p>
            Your assignment has been viewed by
            <strong>${submission.company_name}</strong>
            for the position of
            <strong>${submission.position}</strong>.
          </p>

          <p style="color:#374151;">
            You can check detailed analytics such as views and engagement from your dashboard.
          </p>

          <p style="font-size:12px;color:#6b7280;">
            ${new Date().toLocaleString("en-IN")}
          </p>

          <p>
            Best regards,<br/>
            <strong>BYND Team</strong>
          </p>
        </div>
      `
    });

    console.log(" Email sent:", mailRes.messageId);

    return res.status(200).json({
      success: true,
      message: "Notification processed and email sent",
    });

  } catch (err) {
    console.error("ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});


export default router;

