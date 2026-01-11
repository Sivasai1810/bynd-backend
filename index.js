import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

// routes
import userurl from "./profilefetching/userdatafetching.js";
import previewurls from "./previewsection/preview.js";
import designdetials from "./designdetials/user_design_details.js";
import signup from "./authentication/signup.js";
import login from "./authentication/login.js";
import redirecturl from "./RedirectUrls/redirecturl.js";
import fetching from "./profilefetching/fetchingprofile.js";
import getstats from "./analytics/userstats.js";
import Delete from "./designdetials/deletedesign.js";
import Currentplan from "./subscriptions/currentplan.js";
import DashboardAnalytics from "./profilefetching/analytics.js";
import EmployersviewRoute from "./previewsection/employersview.js";
import DesignPreview from "./previewsection/designpreview.js";
import AnalyticsRoutes from "./analytics/analyticsend.js";
import Sentnotification from "./notification/sentnotification.js";

const app = express();

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "https://bynd-final.vercel.app",
  "https://bynd-backend.onrender.com",
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));

app.use(cookieParser());
app.use('/fonts', express.static('fonts'));

/* ===============================
   🔑 FILE UPLOAD ROUTE FIRST
================================ */
app.use("/storeurls", designdetials);

/* ===============================
   BODY PARSERS AFTER
================================ */
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

/* ===============================
   OTHER ROUTES
================================ */
app.use('/auth/signup', signup);
app.use('/auth/login', login);
app.use('/supabase/redirecturl', redirecturl);
app.use('/fetch/profile', fetching);
app.use('/BYNDLINK/view', previewurls);
app.use('/userurls', userurl);
app.use('/userurls', getstats);
app.use('/submissions', Delete);
app.use('/userplan', Currentplan);
app.use('/getanalytics', DashboardAnalytics);
app.use("/api/preview", EmployersviewRoute);
app.use("/api/view", DesignPreview);
app.use("/api/analytics", AnalyticsRoutes);
app.use("/fetchnotification", Sentnotification);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});

