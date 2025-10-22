import dotenv from "dotenv"
dotenv.config()
import express from 'express';
import bcrypt from 'bcrypt';
import jsonwebtoken from 'jsonwebtoken';
import { supabase_connect } from "../supabase/set-up.js";

const router = express.Router();
const jsonpassword = process.env.JSONWEBPASSWORD;
const isproduction = process.env.ISPRODUCTION === 'true';

router.post('', async (req, res) => {
  const { user_email, user_password, oauth_provider } = req.body;

  try {
    // Fetch user by email
    const { data: existingUser, error } = await supabase_connect
      .from("users_account_details")
      .select('*')
      .eq('user_email', user_email)
      .single();

    // Handle database errors
    if (error && error.code === 'PGRST116') { 
      return res.status(404).json({ message: "User not found", success: false });
    } else if (error) {
      return res.status(500).json({ message: "Database error", success: false });
    }

    if (!existingUser) {
      return res.status(404).json({ message: "User not found", success: false });
    }

    // Determine authentication method
    const isOAuthLogin = !user_password && oauth_provider;
    const isManualLogin = user_password && !oauth_provider;

    // Manual login with password
    if (isManualLogin) {
      if (!existingUser.user_password) {
        return res.status(400).json({ 
          message: "This account uses OAuth login. Please sign in with your provider.", 
          success: false 
        });
      }

      const isMatch = await bcrypt.compare(user_password, existingUser.user_password);
      if (!isMatch) {
        return res.status(401).json({ message: "Incorrect password", success: false });
      }
    } 
    // OAuth login
    else if (isOAuthLogin) {
      // Verify the user was created via OAuth (has no password)
      if (existingUser.user_password) {
        return res.status(400).json({ 
          message: "This account uses password login. Please sign in with your password.", 
          success: false 
        });
      }
      // Additional OAuth verification should happen here (verify token with provider)
    } 
    // Invalid request
    else {
      return res.status(400).json({ 
        message: "Invalid login request. Provide either password or OAuth provider.", 
        success: false 
      });
    }

    // Authentication successful - now generate tokens
    const payload = { id: existingUser.unique_id };
    const AccessToken = jsonwebtoken.sign(payload, jsonpassword, { expiresIn: '2d' });
    const RefreshToken = jsonwebtoken.sign(payload, jsonpassword, { expiresIn: '7d' });

    // Set cookies
    res.cookie('ac_token', AccessToken, {
      httpOnly: true,
      secure: isproduction,
      maxAge: 1000 * 60 * 60 * 24 * 2, // 2 days
      sameSite: isproduction ? 'none' : 'lax',
      path: '/',
    });

    res.cookie('rf_token', RefreshToken, {
      httpOnly: true,
      secure: isproduction,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      sameSite: isproduction ? 'none' : 'lax',
      path: '/'
    });

    return res.json({ 
      message: "User logged in successfully", 
      success: true,
      user: {
        id: existingUser.unique_id,
        email: existingUser.user_email
      }
    });

  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ message: "Server error", success: false });
  }
});

export default router;