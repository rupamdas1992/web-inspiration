const fs = require('fs');
const path = require('path');

// Configuration
const API_KEY = process.env.DRIVE_API_KEY || process.env.PERSONAL_API_KEY || "";
const ROOT_FOLDER_ID = "1l5AcNyxB9caGYiHMAuoI3AiBpltnis5T";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("ERROR: GEMINI_API_KEY environment variable is not defined.");
  console.error("Please get a free key from Google AI Studio (https://aistudio.google.com/)");
  console.error("And run: export GEMINI_API_KEY='your_key' && node scripts/generate_titles_gemini.js");
  process.exit(1);
}

// Paths
const OUTPUT_DIR = path.join(__dirname, '..', 'src', 'data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'image-titles.json');

// Heuristic to detect randomized filenames
function isRandomizedName(name) {
  const baseName = name.split('.')[0];
  const parts = baseName.split(/[-_\s]+/);
  
  for (const part of parts) {
    if (part.length < 8) continue;
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(part);
    if (isUuid) return true;
    const isHex = /^[0-9a-fA-F]{32}$|^[0-9a-fA-F]{40}$|^[0-9a-fA-F]{64}$/.test(part);
    if (isHex) return true;
    const letters = (part.match(/[a-zA-Z]/g) || []).length;
    const digits = (part.match(/[0-9]/g) || []).length;
    if (letters > 0 && digits > 0 && part.length >= 8) return true;
    const vowels = (part.match(/[aeiouAEIOU]/g) || []).length;
    if (letters > 8 && (vowels / letters) < 0.15) return true;
    if (part.length >= 14) return true;
  }
  const isHexHash = /^[0-9a-fA-F]{32,64}$/.test(baseName);
  if (isHexHash) return true;
  return false;
}

// Sleep helper to avoid rate limit (free tier is 15 RPM, so 5s delay is safe)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP error! status: ${res.status} - ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  let mapping = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      mapping = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
      console.log(`Loaded ${Object.keys(mapping).length} existing mapping entries.`);
    } catch (e) {
      console.warn("Warning: Could not parse existing mapping file. Starting fresh.");
    }
  }

  // 1. Fetch Google Drive Folders
  console.log("Fetching folders from Google Drive...");
  let currentSections = [];
  try {
    const folderData = await fetchJson(
      `https://www.googleapis.com/drive/v3/files?q='${ROOT_FOLDER_ID}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&key=${API_KEY}&fields=files(id,name)&pageSize=100`
    );
    currentSections = folderData.files || [];
  } catch (error) {
    console.error("Error fetching folders:", error.message);
    process.exit(1);
  }

  // 2. Fetch image files
  console.log("Fetching images metadata...");
  const allParentIds = [ROOT_FOLDER_ID, ...currentSections.map(s => s.id)];
  let allFiles = [];

  for (const id of allParentIds) {
    let pageToken = null;
    do {
      let query = `trashed=false and mimeType contains 'image/' and '${id}' in parents`;
      let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&key=${API_KEY}&fields=nextPageToken,files(id,name,thumbnailLink,mimeType)&pageSize=100`;
      if (pageToken) {
        url += `&pageToken=${pageToken}`;
      }
      try {
        const data = await fetchJson(url);
        if (data.files) {
          allFiles.push(...data.files);
        }
        pageToken = data.nextPageToken;
      } catch (error) {
        console.error(`Error fetching images:`, error.message);
        break;
      }
    } while (pageToken);
  }

  // 3. Filter candidates needing description
  const candidates = allFiles.filter(file => {
    if (mapping[file.id]) return false;
    return isRandomizedName(file.name);
  });

  console.log(`Found ${candidates.length} images with randomized names needing description.`);

  if (candidates.length === 0) {
    console.log("All randomized images already renamed. Done!");
    process.exit(0);
  }

  console.log(`Starting title generation with Gemini 2.5 Flash free tier.`);
  console.log(`Rate limit protection active (5s delay between images).`);

  for (let i = 0; i < candidates.length; i++) {
    const file = candidates[i];
    console.log(`[${i + 1}/${candidates.length}] Processing "${file.name}" (ID: ${file.id})...`);

    try {
      // Get image buffer
      const thumbUrl = file.thumbnailLink 
        ? file.thumbnailLink.replace(/=s\d+.*$/, "=w800") 
        : `https://drive.google.com/thumbnail?id=${file.id}&sz=w800`;
      
      let imgResponse = await fetch(thumbUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
          'Referer': 'https://drive.google.com/'
        }
      });
      
      if (!imgResponse.ok) {
        imgResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${API_KEY}`);
      }

      if (!imgResponse.ok) {
        throw new Error(`Failed to download image from Drive: Status ${imgResponse.status}`);
      }

      const buffer = Buffer.from(await imgResponse.arrayBuffer());
      const base64Image = buffer.toString('base64');
      
      // Determine correct mimeType for Gemini API
      let mimeType = file.mimeType || 'image/jpeg';
      if (mimeType === 'image/gif') {
        // Gemini API supports GIF, but static JPEGs are safer. We pass the mimeType as is.
      }

      // Call Gemini 2.5 Flash API
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
      const payload = {
        contents: [
          {
            parts: [
              {
                text: "Describe the main UI component shown in this screenshot in 3 words (e.g., 'Dashboard User Profile', 'Analytics Charts Table', 'Mobile Settings Page'). Respond with ONLY the 3-word title, no quotes, no explanation, no extra text."
              },
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Image
                }
              }
            ]
          }
        ]
      };

      const geminiRes = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!geminiRes.ok) {
        throw new Error(`Gemini API error ${geminiRes.status}: ${await geminiRes.text()}`);
      }

      const geminiData = await geminiRes.json();
      let generatedTitle = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      let cleanTitle = generatedTitle
        .trim()
        .replace(/^["']|["']$/g, '')          // Strip outer quotes
        .replace(/\*.*$/g, '')                 // Strip comments after asterisks
        .replace(/\(.*?\)/g, '')               // Strip anything in parentheses
        .replace(/\[.*?\]/g, '')               // Strip anything in brackets
        .replace(/[^a-zA-Z0-9\s-_/]/g, '')     // Clean characters
        .trim();

      if (!cleanTitle) {
        throw new Error("Gemini returned empty or invalid text.");
      }

      console.log(`    -> Generated Title: "${cleanTitle}"`);

      // Update mapping and save
      mapping[file.id] = cleanTitle;
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(mapping, null, 2), 'utf8');

      // Rate limit protection
      if (i < candidates.length - 1) {
        await sleep(5000);
      }
    } catch (err) {
      console.error(`  [ERROR] Failed to process:`, err.message);
    }
  }

  console.log(`\nAll done! New titles saved to ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error("Fatal Error:", err);
  process.exit(1);
});
