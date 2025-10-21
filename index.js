import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

// your imports
import userurl from "./profilefetching/userdatafetching.js";
import previewurls from "./previewsection/preview.js";
import designdetails from "./designdetials/user_design_details.js";
import signup from "./authentication/signup.js";
import login from "./authentication/login.js";
import redirecturl from "./supabase/redirecturl.js";
import fetching from "./fetch/profile.js";

const app = express();
app.use(express.json());
app.use(cookieParser());

// Allow multiple origins
const allowedOrigins = [
  "http://localhost:5173",       // local dev
  "https://bynd-final.vercel.app" // deployed frontend
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // allow Postman or server-to-server
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));

// Routes
app.use('/auth/signup', signup);
app.use('/auth/login', login);
app.use('/supabase/redirecturl', redirecturl);
app.use('/fetch/profile', fetching);
app.use('/storeurls', designdetails);
app.use('/preview', previewurls);
app.use('/userurls', userurl);

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`Server is started on port ${port}`);
});
