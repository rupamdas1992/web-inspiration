const fs = require('fs');
const path = require('path');

// Configuration
const PERSONAL_API_KEY = "AIzaSyATzRsoLIFQQ1JBPfYWNEvgwdapkW4RWN4";
const ROOT_FOLDER_ID = "1l5AcNyxB9caGYiHMAuoI3AiBpltnis5T";

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
    if (letters > 0 && digits > 0 && part.length >= 8) {
      return true;
    }

    const vowels = (part.match(/[aeiouAEIOU]/g) || []).length;
    if (letters > 8 && (vowels / letters) < 0.15) {
      return true;
    }

    if (part.length >= 14) {
      return true;
    }
  }

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
  const modelName = process.env.OLLAMA_MODEL || "moondream";

  // Load existing mapping if it exists
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

  // 2. Fetch all image files
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

  // 3. Filter candidates
  const candidates = allFiles.filter(file => {
    if (mapping[file.id]) return false;
    return isRandomizedName(file.name);
  });

  console.log(`Found ${candidates.length} images with randomized names needing description.`);

  if (candidates.length === 0) {
    console.log("No new images need renaming. Done!");
    process.exit(0);
  }

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Check if local Ollama is running
  console.log(`Verifying connection to Ollama (checking for model: "${modelName}")...`);
  try {
    const checkRes = await fetch("http://localhost:11434/api/tags");
    if (!checkRes.ok) throw new Error();
    const checkJson = await checkRes.json();
    const models = checkJson.models || [];
    const hasModel = models.some(m => m.name.startsWith(modelName));
    if (!hasModel) {
      console.warn(`WARNING: Model "${modelName}" was not found in your Ollama models list.`);
      console.warn(`Please run "ollama run ${modelName}" in your terminal first.`);
    }
  } catch (e) {
    console.error("ERROR: Cannot connect to local Ollama instance on http://localhost:11434");
    console.error("Please make sure Ollama is installed and running on your computer.");
    process.exit(1);
  }

  console.log(`Starting local naming process. Using model: "${modelName}"`);
  console.log("Press Ctrl+C to stop at any time. Progress is saved after every successful request.");

  for (let i = 0; i < candidates.length; i++) {
    const file = candidates[i];
    console.log(`[${i + 1}/${candidates.length}] Processing "${file.name}" (ID: ${file.id})...`);

    try {
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
        const driveApiUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${PERSONAL_API_KEY}`;
        imgResponse = await fetch(driveApiUrl);
      }

      if (!imgResponse.ok) {
        throw new Error(`Failed to download image: status ${imgResponse.status}`);
      }
      const buffer = Buffer.from(await imgResponse.arrayBuffer());
      const base64Image = buffer.toString('base64');

      // Call Local Ollama endpoint
      const ollamaUrl = "http://localhost:11434/api/generate";
      const requestBody = {
        model: modelName,
        prompt: "Describe the main UI component shown in this screenshot in 3 words.",
        images: [base64Image],
        stream: false,
        options: {
          temperature: 0.2
        }
      };

      const ollamaRes = await fetch(ollamaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!ollamaRes.ok) {
        throw new Error(`Ollama returned status ${ollamaRes.status}: ${await ollamaRes.text()}`);
      }

      const ollamaData = await ollamaRes.json();
      let generatedTitle = ollamaData.response || '';
      
      let cleanTitle = generatedTitle
        .trim()
        .replace(/^["']|["']$/g, '')          // Strip outer quotes
        .replace(/\*.*$/g, '')                 // Strip comments after asterisks
        .replace(/\(.*?\)/g, '')               // Strip anything in parentheses
        .replace(/\[.*?\]/g, '')               // Strip anything in brackets
        .replace(/[^a-zA-Z0-9\s-_/]/g, '')     // Only keep alphanumeric + standard separators
        .trim();

      if (!cleanTitle) {
        throw new Error(`Ollama returned an empty/invalid title: "${generatedTitle}"`);
      }

      console.log(`    -> Generated Title: "${cleanTitle}"`);

      // Update mapping and save
      mapping[file.id] = cleanTitle;
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(mapping, null, 2), 'utf8');

    } catch (err) {
      console.error(`  [ERROR] Failed to process ${file.name}:`, err.message);
    }
  }

  console.log(`\nProcessing complete! Dynamic titles saved to ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error("Fatal Error:", err);
  process.exit(1);
});
