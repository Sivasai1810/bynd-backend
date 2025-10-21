import express from 'express';
import { supabase_connect } from "../supabase/set-up.js";
import verifyToken from "../middlewares/verifytoken.js";

const router = express.Router();
router.use(express.json());
router.post('', verifyToken, async (req, res) => {

  try {
    const user_id = req.user;
console.log("hello")
    const { data, error } = await supabase_connect
      .from("users_account_details")
      .select('*')
      .eq('unique_id', user_id)
      .single();

    if (error || !data) {
      console.error("Supabase error:", error);
      return res.status(400).json({ message: "Failed to fetch user details" });
    }

    const { user_email, user_name } = data;

    res.json({
      message: "User details fetched successfully",
      profile: { user_email, user_name },
    });

  } catch (err) {
    console.error("Error:", err);
    res.status(401).json({ message: "Session expired" });
  }
});

export default router;
