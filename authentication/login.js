import express from 'express';
import bcrypt from 'bcrypt';
import jsonwebtoken from 'jsonwebtoken';
import { supabase_connect } from "../supabase/set-up.js";
const router = express.Router();
const jsonpassword=process.env.JSONWEBPASSWORD
router.post('', async (req, res) => {
  const { user_email, user_password } = req.body;
console.log("error")
  try {
    // Fetch user by email
    const { data: existingUser, error } = await  supabase_connect
      .from("users_account_details")
      .select('*')
      .eq('user_email', user_email)
      .single();

    //    if (error && error.code === 'PGRST116') { 
    //   return res.status(404).json({ message: "User not found" });
    // } else
    // if (error) {
    //   return res.status(500).json({ message: error.message });
    // }
    if (!existingUser) {
  return res.json({ message: "User not found", success: false });
}
    const playload={id:existingUser.unique_id}
const AccessToken=jsonwebtoken.sign(playload,jsonpassword,{expiresIn:'2d'})
const RefreshToken =jsonwebtoken.sign(playload,jsonpassword,{expiresIn:'7d'})
res.cookie('ac_token',AccessToken,{
    httpOnly:false,
    secure:false,
    maxAge:1000*60*60*24*2,
    sameSite:'lax',
})
res.cookie('rf_token',RefreshToken,{
    httpOnly:true,
    secure:false,
    maxAge:1000*60*60*24*7,
    sameSite:'lax'
})
 // Manual login
    if (user_password) {
      const isMatch = await bcrypt.compare(user_password, existingUser.user_password);
      if (isMatch) {
        return res.json({ message: "User logged in successfully" ,success:true});
      } else {
        return res.json({ message: "Incorrect password",success:false });
      }
    }

    // OAuth login (password not provided)
    return res.json({ message: "User logged in successfully" ,success:true});

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
