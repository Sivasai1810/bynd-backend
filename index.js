import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

// your imports
import userurl from "./profilefetching/userdatafetching.js";
import previewurls from "./previewsection/preview.js";
import designdetails from "./designdetials/user_design_details.js";
import signup from "./authentication/signup.js";
import login from "./authentication/login.js";
import redirecturl from "./RedirectUrls/redirecturl.js";
import fetching from "./profilefetching/fetchingprofile.js";
import getstats from "./analytics/userstats.js";
import Delete from "./designdetials/deletedesign.js";
import Currentplan from "./subscriptions/currentplan.js"
import DashboardAnalytics from "./profilefetching/analytics.js"
const app = express();

// 1. Basic middleware first
app.use(express.json());
app.use(cookieParser());

// 2. Static files
app.use('/fonts', express.static('fonts'));

// 3. CORS configuration
const allowedOrigins = [
  "http://localhost:3000",  // Fixed the space
  "http://localhost:5173",      
  "https://bynd-final.vercel.app" ,
  "https://bynd-backend.onrender.com"
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);  // Allow same-origin
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));

// 4. Routes
app.use('/auth/signup', signup);
app.use('/auth/login', login);
app.use('/supabase/redirecturl', redirecturl);
app.use('/fetch/profile', fetching);
app.use('/storeurls', designdetails);
app.use('/BYNDLINK/view', previewurls); 
app.use('/userurls', userurl);
app.use('/userurls', getstats);
app.use('/submissions', Delete);
app.use("/userplan", Currentplan);
app.use('/getanalytics', DashboardAnalytics);
const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
