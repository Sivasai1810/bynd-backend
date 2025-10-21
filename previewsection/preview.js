import express from "express";
import { supabase_connect } from "../supabase/set-up.js";

const router = express.Router();

// Get preview by unique ID
router.get('/:uniqueId', async (req, res) => {
  try {
    const { uniqueId } = req.params;

    if (!uniqueId) {
      return res.status(400).json({ error: "Missing unique ID" });
    }
    // Search all users for this unique_id
    const { data: allUsers, error } = await supabase_connect
      .from("user_urls")
      .select("*");

    if (error) {
      console.error("Fetch error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    // Find the user and index where this unique_id exists
    let foundData = null;
    for (const user of allUsers) {
      if (user.unique_id && user.unique_id.includes(uniqueId)) {
        const index = user.unique_id.indexOf(uniqueId);
        
        foundData = {
          preview_url: user.preview_url[index],
          pasted_url: user.pasted_url[index],
          companyname: user.companyname[index],
          position: user.position[index],
          status: user.status[index],
          created_at: user.created_at[index]
        };
        break;
      }
    }

    if (!foundData) {
      return res.status(404).json({ error: "Design not found" });
    }

    // Return HTML page with embedded Figma design
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${foundData.companyname} - ${foundData.position}</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          background: #f5f5f5;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          overflow-x: hidden;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        }
        .header {
          background: white;
          padding: 24px 40px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }
        .header h1 {
          color: #1a1a1a;
          font-size: 20px;
          margin-bottom: 6px;
          font-weight: 600;
        }
        .header p {
          color: #666;
          font-size: 13px;
        }
        .container {
          flex: 1;
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 20px;
          position: relative;
        }
        .figma-wrapper {
          width: 100%;
          max-width: 1400px;
          height: 85vh;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          background: white;
          overflow: scroll;
          -webkit-overflow-scrolling: touch;
          position: relative;
          border: 1px solid #e5e5e5;
          scrollbar-width: none; /* Firefox */
          -ms-overflow-style: none; /* IE and Edge */
        }
        .figma-wrapper::-webkit-scrollbar {
          display: none; /* Chrome, Safari, Opera */
        }
        .figma-frame {
          width: 100%;
          min-width: 1200px;
          height: 100%;
          min-height: 800px;
          border: none;
          display: block;
        }
        .overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 60px;
          background: white;
          z-index: 999;
          pointer-events: all;
          box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        }
        .copy-btn {
          position: fixed;
          bottom: 30px;
          right: 30px;
          background: #1DBC79;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(29, 188, 121, 0.3);
          transition: all 0.2s ease;
          z-index: 1000;
        }
        .copy-btn:hover {
          background: #18a865;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(29, 188, 121, 0.4);
        }
        .copy-btn:active {
          transform: translateY(0);
        }
        .copied {
          position: fixed;
          bottom: 100px;
          right: 30px;
          background: #1DBC79;
          color: white;
          padding: 12px 24px;
          border-radius: 6px;
          font-weight: 600;
          opacity: 0;
          transition: opacity 0.3s ease;
          pointer-events: none;
          box-shadow: 0 2px 8px rgba(29, 188, 121, 0.3);
          z-index: 1000;
        }
        .copied.show {
          opacity: 1;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${foundData.companyname} - ${foundData.position}</h1>
        <p>Design Submission • Status: ${foundData.status}</p>
      </div>
      
      <div class="container">
        <div class="figma-wrapper">
          <div class="overlay"></div>
          <iframe 
            class="figma-frame"
            src="${foundData.preview_url}"
            allowfullscreen
            sandbox="allow-same-origin allow-scripts allow-popups"
            scrolling="yes"
          ></iframe>
        </div>
      </div>

      <button class="copy-btn" onclick="copyLink()">
         Copy Link
      </button>

      <div class="copied" id="copiedMsg">
        ✓ Link copied!
      </div>

      <script>
        function copyLink() {
          const link = window.location.href;
          navigator.clipboard.writeText(link).then(() => {
            const msg = document.getElementById('copiedMsg');
            msg.classList.add('show');
            setTimeout(() => {
              msg.classList.remove('show');
            }, 2000);
          });
        }
      </script>
    </body>
    </html>
    `;

    res.send(html);

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Server error occurred" });
  }
});

export default router;