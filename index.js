// import express from "express";
// import cors from "cors";
// import cookieParser from "cookie-parser";

// // your imports
// import userurl from "./profilefetching/userdatafetching.js";
// import previewurls from "./previewsection/preview.js";
// import designdetails from "./designdetials/user_design_details.js";
// import signup from "./authentication/signup.js";
// import login from "./authentication/login.js";
// import redirecturl from "./RedirectUrls/redirecturl.js";
// import fetching from "./profilefetching/fetchingprofile.js";
// import getstats from "./analytics/userstats.js";
// import Delete from "./designdetials/deletedesign.js";
// import Currentplan from "./subscriptions/currentplan.js"
// import DashboardAnalytics from "./profilefetching/analytics.js"
// import EmployersviewRoute from "./previewsection/employersview.js"
// import DesignPreview from "./previewsection/designpreview.js"
// import AnalyticsRoutes from "./analytics/analyticsend.js"
//  const app = express();
// app.use(express.json());
// app.use(cookieParser());
// app.use('/fonts', express.static('fonts'));
// app.use(express.urlencoded({ extended: true }));

// // 3. CORS configuration
// const allowedOrigins = [
//   "http://localhost:3000",  // Fixed the space
//   "http://localhost:5173",      
//   "https://bynd-final.vercel.app" ,
//   "https://bynd-backend.onrender.com"
// ];
// app.use(express.text());

// app.use(cors({
//   origin: function (origin, callback) {
//     if (!origin) return callback(null, true);                      
//     if (allowedOrigins.includes(origin)) {
//       callback(null, true);
//     } else {
//       callback(new Error("Not allowed by CORS"));
//     }
//   },
//   credentials: true
// }));

// // 4. Routes
// app.use('/auth/signup', signup);
// app.use('/auth/login', login);
// app.use('/supabase/redirecturl', redirecturl);
// app.use('/fetch/profile', fetching);
// app.use('/storeurls', designdetails);
// app.use('/BYNDLINK/view', previewurls); 
// app.use('/userurls', userurl);
// app.use('/userurls', getstats);
// app.use('/submissions', Delete);
// app.use("/userplan", Currentplan);
// app.use('/getanalytics', DashboardAnalytics);
// app.use("/api/preview",EmployersviewRoute);
// app.use("/api/view",DesignPreview)
// app.use("/api/analytics", AnalyticsRoutes);

// const port = process.env.PORT || 5000;
// app.listen(port, () => {
//   console.log(`Server started on port ${port}`);
// });
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

const app = express();

/* ✅ CORS FIRST */
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

/* ✅ BASIC MIDDLEWARE */
app.use(cookieParser());
app.use('/fonts', express.static('fonts'));

/* ✅ IMPORTANT: multer route BEFORE body parsers */
app.use('/storeurls', designdetials);

/* ✅ body parsers AFTER upload route */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ✅ OTHER ROUTES */
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

/* ✅ START SERVER */
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Server started on port ${port}`);
});
