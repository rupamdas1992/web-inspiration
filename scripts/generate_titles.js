const fs = require('fs');
const path = require('path');

// Configuration
const PERSONAL_API_KEY = "AIzaSyATzRsoLIFQQ1JBPfYWNEvgwdapkW4RWN4";
const ROOT_FOLDER_ID = "1l5AcNyxB9caGYiHMAuoI3AiBpltnis5T";

// Paths
const OUTPUT_DIR = path.join(__dirname, '..', 'src', 'data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'image-titles.json');

// Heuristic to detect randomized filenames (including prefixed names like original-xxxx)
function isRandomizedName(name) {
  const baseName = name.split('.')[0];
  
  // Split by separators (spaces, hyphens, underscores)
  const parts = baseName.split(/[-_\s]+/);
  
  for (const part of parts) {
    if (part.length < 8) continue;
    
    // 1. UUIDs (8-4-4-4-12 hex chars)
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(part);
    if (isUuid) return true;

    // 2. MD5 / SHA Hashes (e.g. 32, 40, or 64 hex chars)
    const isHex = /^[0-9a-fA-F]{32}$|^[0-9a-fA-F]{40}$|^[0-9a-fA-F]{64}$/.test(part);
    if (isHex) return true;

    // 3. General long random alphanumeric sequence (letters + digits, no dictionary structure)
    const letters = (part.match(/[a-zA-Z]/g) || []).length;
    const digits = (part.match(/[0-9]/g) || []).length;
    if (letters > 0 && digits > 0 && part.length >= 8) {
      return true;
    }

    // 4. Extremely low vowel density
    const vowels = (part.match(/[aeiouAEIOU]/g) || []).length;
    if (letters > 8 && (vowels / letters) < 0.15) {
      return true;
    }

    // 5. Very long continuous alphabetic/hex sequence without separations
    if (part.length >= 14) {
      return true;
    }
  }

  // Fallback check on full name
  const isHexHash = /^[0-9a-fA-F]{32,64}$/.test(baseName);
  if (isHexHash) return true;

  return false;
}

// Fetch helper that returns JSON
async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP error! status: ${res.status} - ${await res.text()}`);
  }
  return res.json();
}

// Main execution function
async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey && !isDryRun) {
    console.error("ERROR: GEMINI_API_KEY environment variable is not set.");
    console.error("Please run the script as: GEMINI_API_KEY=your_key node scripts/generate_titles.js");
    console.error("Or run a dry run check: node scripts/generate_titles.js --dry-run");
    process.exit(1);
  }

  // Load existing mapping if it exists to avoid re-processing
  let mapping = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      mapping = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
      console.log(`Loaded ${Object.keys(mapping).length} existing mapping entries from ${OUTPUT_FILE}`);
    } catch (e) {
      console.warn(`Warning: Could not parse existing mapping file: ${e.message}. Starting fresh.`);
    }
  }

  // 1. Fetch Google Drive Folders (Sections)
  console.log("Fetching folder structures from Google Drive...");
  let currentSections = [];
  try {
    const folderData = await fetchJson(
      `https://www.googleapis.com/drive/v3/files?q='${ROOT_FOLDER_ID}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&key=${PERSONAL_API_KEY}&fields=files(id,name)&pageSize=100`
    );
    currentSections = folderData.files || [];
    console.log(`Found ${currentSections.length} section folders.`);
  } catch (error) {
    console.error("Error fetching folders:", error.message);
    process.exit(1);
  }

  // 2. Fetch all image files across all section folders and root folder
  console.log("Fetching images metadata...");
  const allParentIds = [ROOT_FOLDER_ID, ...currentSections.map(s => s.id)];
  let allFiles = [];

  for (const id of allParentIds) {
    let pageToken = null;
    do {
      let query = `trashed=false and mimeType contains 'image/' and '${id}' in parents`;
      let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&key=${PERSONAL_API_KEY}&fields=nextPageToken,files(id,name,thumbnailLink)&pageSize=100`;
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
        console.error(`Error fetching images for folder ${id}:`, error.message);
        break;
      }
    } while (pageToken);
  }

  console.log(`Total images found in Google Drive: ${allFiles.length}`);

  // 3. Filter only those files with randomized names that are not already renamed
  const candidates = allFiles.filter(file => {
    // If it's already in our mapping, skip it
    if (mapping[file.id]) return false;
    // Check if the name is randomized
    return isRandomizedName(file.name);
  });

  console.log(`Found ${candidates.length} images with randomized names needing ML description.`);

  if (isDryRun) {
    console.log("\n--- DRY RUN CANDIDATES PREVIEW (First 10) ---");
    candidates.slice(0, 10).forEach((file, idx) => {
      console.log(`${idx + 1}. Name: "${file.name}" (ID: ${file.id})`);
    });
    console.log("--------------------------------------------");
    console.log(`Dry run complete. ${candidates.length} candidates total. No requests were sent to Gemini.`);
    process.exit(0);
  }

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // 4. Process candidates through Gemini API with rate limiting
  // Free tier has rate limit (1 request every 12.5 seconds to stay safely under 5 RPM / token limits)
  const delayMs = 12500; 
  console.log(`Starting naming process. Rate limit buffer: 1 request every ${delayMs / 1000}s.`);
  console.log("Press Ctrl+C to stop at any time. Progress is saved after every successful request.");

  for (let i = 0; i < candidates.length; i++) {
    const file = candidates[i];
    console.log(`[${i + 1}/${candidates.length}] Processing "${file.name}" (ID: ${file.id})...`);

    try {
      // Get thumbnail image data and convert to base64
      // Use drive thumbnail fallback if link is not available
      const thumbUrl = file.thumbnailLink ? file.thumbnailLink.replace(/=s\d+.*$/, "=w400") : `https://drive.google.com/thumbnail?id=${file.id}&sz=w400`;
      
      let imgResponse = await fetch(thumbUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://drive.google.com/',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });
      
      if (!imgResponse.ok) {
        // Fallback to fetching directly from Drive API using our PERSONAL_API_KEY
        const driveApiUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${PERSONAL_API_KEY}`;
        imgResponse = await fetch(driveApiUrl);
      }

      if (!imgResponse.ok) {
        throw new Error(`Failed to download image: status ${imgResponse.status}`);
      }
      const buffer = Buffer.from(await imgResponse.arrayBuffer());
      const base64Image = buffer.toString('base64');

      // Call Gemini 2.5 Flash Vision Model
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;
      const requestBody = {
        contents: [
          {
            parts: [
              {
                text: "Describe this UI screenshot image in 2 to 4 clean, highly descriptive, and search-friendly words. It should look like a proper web page or application screen title (e.g., 'SaaS Analytics Dashboard', 'Mobile Login Screen', 'Pricing Table Redesign', 'Course Detail View'). Do NOT include file extensions, symbols, or conversational text. Output ONLY the descriptive title. Do not include word count, reviews, stars, ratings, quotes, or punctuation."
              },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: base64Image
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 250
        }
      };

      let attempts = 0;
      let geminiRes;
      while (attempts < 3) {
        geminiRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (geminiRes.status === 429) {
          console.warn(`    [RATE LIMIT] Hit 429 rate limit. Waiting 15 seconds to retry...`);
          await new Promise(resolve => setTimeout(resolve, 15000));
          attempts++;
        } else {
          break;
        }
      }

      if (!geminiRes.ok) {
        throw new Error(`Gemini API returned status ${geminiRes.status}: ${await geminiRes.text()}`);
      }

      const geminiData = await geminiRes.json();
      let generatedTitle = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      // Clean title from extra comments, word counts, and markdown returned by LLM
      let cleanTitle = generatedTitle
        .trim()
        .replace(/^["']|["']$/g, '')          // Strip outer quotes
        .replace(/\*.*$/g, '')                 // Strip comments after asterisks
        .replace(/\(.*?\)/g, '')               // Strip anything in parentheses
        .replace(/\[.*?\]/g, '')               // Strip anything in brackets
        .replace(/[^a-zA-Z0-9\s-_/]/g, '')     // Only keep alphanumeric + standard separators
        .trim();

      if (!cleanTitle || cleanTitle.toLowerCase() === 'good' || cleanTitle.toLowerCase() === 'very accurate') {
        throw new Error(`Gemini API returned an invalid/empty title: "${generatedTitle}"`);
      }

      console.log(`    -> Generated Title: "${cleanTitle}" (raw: "${generatedTitle.trim()}")`);

      // Update mapping and save to file immediately
      mapping[file.id] = cleanTitle;
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(mapping, null, 2), 'utf8');

    } catch (err) {
      console.error(`  [ERROR] Failed to process ${file.name}:`, err.message);
      // We will continue to the next one, hoping it's a transient failure
    }

    // Rate limiting delay (only if there are more files to process)
    if (i < candidates.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  console.log(`\nProcessing complete! Dynamic titles saved to ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error("Fatal Error:", err);
  process.exit(1);
});
