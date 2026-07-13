// Helper to convert Google Drive IDs to direct image links
// Note: Users will need to replace 'YOUR_FILE_ID' with actual IDs from the drive
export const getDriveUrl = (id: string, type: 'thumb' | 'full' = 'thumb') => {
  return type === 'thumb' 
    ? `https://lh3.googleusercontent.com/u/0/d/${id}=w400-h300-p-k-no`
    : `https://lh3.googleusercontent.com/u/0/d/${id}=w1600-h1200-p-k-no`;
};

export interface InspirationItem {
  id: string;
  title: string;
  thumbnailUrl: string;
  fullImageUrl: string;
  size: string;
  dateUploaded: string;
  tags: string[];
  topics: string[];
  section: string;
}

// Initializing with your actual folder categories
export const mockInspiration: InspirationItem[] = [
  {
    id: "1l5AcNyxB9caGYiHMAuoI3AiBpltnis5T", // Root Folder ID for now
    title: "Admin SaaS Console",
    thumbnailUrl: "https://picsum.photos/seed/admin/400/300",
    fullImageUrl: "https://picsum.photos/seed/admin/1200/900",
    size: "2.4MB",
    dateUploaded: "2026-03-05",
    tags: ["saas", "console", "admin"],
    topics: ["Admin", "SaaS", "Multi-prof Console"],
    section: "Admin & SaaS"
  },
  {
    id: "folder_ai",
    title: "AI Chatbot Interface",
    thumbnailUrl: "https://picsum.photos/seed/ai/400/300",
    fullImageUrl: "https://picsum.photos/seed/ai/1200/900",
    size: "1.8MB",
    dateUploaded: "2026-03-05",
    tags: ["ai", "bot", "chat"],
    topics: ["AI", "Chatbot", "Bot"],
    section: "AI & Communication"
  },
  {
    id: "folder_data",
    title: "Analytics Dashboard",
    thumbnailUrl: "https://picsum.photos/seed/data/400/300",
    fullImageUrl: "https://picsum.photos/seed/data/1200/900",
    size: "3.1MB",
    dateUploaded: "2026-03-05",
    tags: ["analytics", "charts", "data"],
    topics: ["Analytics", "Data Warehouse", "Settings"],
    section: "Dashboards"
  },
  {
    id: "folder_mobile",
    title: "Mobile App Screenflows",
    thumbnailUrl: "https://picsum.photos/seed/mobile/400/300",
    fullImageUrl: "https://picsum.photos/seed/mobile/1200/900",
    size: "950KB",
    dateUploaded: "2026-03-05",
    tags: ["mobile", "native", "ios"],
    topics: ["Mobile", "App Screens", "Responsive"],
    section: "Mobile"
  },
  {
    id: "folder_forms",
    title: "Complex Multi-step Form",
    thumbnailUrl: "https://picsum.photos/seed/forms/400/300",
    fullImageUrl: "https://picsum.photos/seed/forms/1200/900",
    size: "1.2MB",
    dateUploaded: "2026-03-05",
    tags: ["forms", "stepper", "input"],
    topics: ["Forms", "Complex", "Long-form"],
    section: "Components"
  },
  {
    id: "folder_ds",
    title: "Design System Documentation",
    thumbnailUrl: "https://picsum.photos/seed/ds/400/300",
    fullImageUrl: "https://picsum.photos/seed/ds/1200/900",
    size: "4.5MB",
    dateUploaded: "2026-03-05",
    tags: ["design-system", "figma", "tokens"],
    topics: ["Design System", "Figma Files"],
    section: "Core Design"
  }
];
