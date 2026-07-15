const fs = require('fs');
const path = require('path');

// Configuration
const ROOT_FOLDER_ID = '1l5AcNyxB9caGYiHMAuoI3AiBpltnis5T';
const DRIVE_API_KEY = process.env.DRIVE_API_KEY || process.env.PERSONAL_API_KEY;

if (!DRIVE_API_KEY) {
  console.error('ERROR: DRIVE_API_KEY or PERSONAL_API_KEY environment variable is not defined.');
  process.exit(1);
}

// File paths
const TITLES_PATH = path.join(__dirname, '../src/data/image-titles.json');
const OUTPUT_PATH = path.join(__dirname, '../public/inspiration-data.json');

// Read custom image titles
let imageTitles = {};
try {
  if (fs.existsSync(TITLES_PATH)) {
    const rawTitles = fs.readFileSync(TITLES_PATH, 'utf8');
    imageTitles = JSON.parse(rawTitles);
    console.log(`Loaded ${Object.keys(imageTitles).length} custom image titles.`);
  }
} catch (err) {
  console.warn('Warning: Failed to load src/data/image-titles.json. Using defaults.', err.message);
}

// Helper to make API calls to Google Drive API v3
async function driveFetch(endpoint) {
  const url = `https://www.googleapis.com/drive/v3/${endpoint}&key=${DRIVE_API_KEY}`;
  const response = await fetch(url);
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google Drive API error: ${response.status} ${response.statusText} - ${errText}`);
  }
  return response.json();
}

async function run() {
  try {
    console.log('Fetching Google Drive subfolders...');
    // 1. Fetch Subfolders
    const folderQuery = encodeURIComponent(`'${ROOT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const folderData = await driveFetch(`files?q=${folderQuery}&fields=files(id,name,createdTime)&pageSize=100`);
    const folders = folderData.files || [];
    console.log(`Found ${folders.length} folders (sections).`);

    // Map parent folders
    const folderMap = {};
    folders.forEach(f => {
      folderMap[f.id] = f.name;
    });
    folderMap[ROOT_FOLDER_ID] = 'General';

    // 2. Fetch images for all folders (ROOT + Subfolders)
    const allFolderIds = [ROOT_FOLDER_ID, ...folders.map(f => f.id)];
    const items = [];

    for (const folderId of allFolderIds) {
      const folderName = folderMap[folderId];
      console.log(`Fetching images from folder: "${folderName}" (${folderId})...`);
      
      let pageToken = '';
      let fileCount = 0;
      
      do {
        const query = encodeURIComponent(`trashed=false and mimeType contains 'image/' and '${folderId}' in parents`);
        let endpoint = `files?q=${query}&fields=nextPageToken,files(id,name,size,imageMediaMetadata,createdTime,parents,thumbnailLink,webContentLink)&pageSize=100`;
        if (pageToken) {
          endpoint += `&pageToken=${pageToken}`;
        }
        
        const fileData = await driveFetch(endpoint);
        const files = fileData.files || [];
        fileCount += files.length;
        
        files.forEach(file => {
          const sizeInMB = file.size ? (parseInt(file.size) / (1024 * 1024)).toFixed(1) : '0.0';
          // Always use permanent, non-expiring Google Drive CDN endpoints
          const thumbUrl = `https://lh3.googleusercontent.com/d/${file.id}=w800`;
          const imageUrl = `https://lh3.googleusercontent.com/d/${file.id}=w1600`;

          items.push({
            id: file.id,
            title: imageTitles[file.id] || file.name.split('.')[0],
            imageUrl: imageUrl,
            thumbnailUrl: thumbUrl,
            dimensions: file.imageMediaMetadata ? `${file.imageMediaMetadata.width} × ${file.imageMediaMetadata.height}` : 'Original',
            size: `${sizeInMB} MB`,
            date: new Date(file.createdTime).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            }),
            section: folderName,
            topic: 'Inspiration',
            tags: ['Drive', folderName],
            rawSize: file.size ? parseInt(file.size) : 0
          });
        });
        
        pageToken = fileData.nextPageToken || '';
      } while (pageToken);
      
      console.log(`Retrieved ${fileCount} images from folder "${folderName}".`);
    }

    // Sort items by date descending (newest first)
    items.sort((a, b) => new Date(b.date) - new Date(a.date));

    // 3. Write data to public/inspiration-data.json
    const outputDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputData = {
      sections: folders.map(f => ({
        id: f.id,
        name: f.name,
        createdTime: f.createdTime
      })),
      items: items
    };

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(outputData, null, 2), 'utf8');
    console.log(`Successfully sync'd Google Drive data! Saved ${items.length} items to ${OUTPUT_PATH}`);
  } catch (error) {
    console.error('Failed to sync Google Drive data:', error.message);
    process.exit(1);
  }
}

run();
