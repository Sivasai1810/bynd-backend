import dotenv from 'dotenv'
import jsonwebtoken from "jsonwebtoken"
dotenv.config()
const jsonpassword = process.env.JSONWEBPASSWORD
const isproduction=process.env.ISPRODUCTION==='true'
const verifyToken = async (req, res, next) => {
  try {
    const RefreshToken = req.cookies.rf_token; 
    const AccessToken = req.cookies.ac_token;

    if (!RefreshToken && !AccessToken) {
      return res.status(401).json({ message: "No token found" });
    }

    //  First check if Access Token exists and is valid
    if (AccessToken) {
      try {
        const decoded = jsonwebtoken.verify(AccessToken, jsonpassword);
        req.user = decoded.id;
        return next();
      } catch (err) {
        // access token expired — we’ll try refresh below
      }
    }

    // If Access Token invalid or missing, verify the Refresh Token
    if (RefreshToken) {
      try {
        const decoded = jsonwebtoken.verify(RefreshToken, jsonpassword);
        const payload = { id: decoded.id};

        // create new access token
        const newAccessToken = jsonwebtoken.sign(payload, jsonpassword, {
          expiresIn: "2d",
        });

        // set new cookie
        res.cookie("ac_token", newAccessToken, {
             httpOnly:true,
    secure:isproduction?true:false,
    maxAge:1000*60*60*24*2,
    sameSite:isproduction?'none':'lax',
        });

        req.user = decoded.id;
        return next();
      } catch (err) {
        return res.status(403).json({ message: "Invalid refresh token" });
      }
    }

  } catch (err) {
    console.error("Error verifying tokens:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
export default verifyToken