import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  Search,
  LayoutGrid,
  List,
  PanelLeftClose,
  PanelLeftOpen,
  LayoutTemplate,
  Palette,
  MousePointerClick,
  Sparkles,
  Eye,
  Loader2,
  Folder,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./components/ui/dialog"
import { ScrollArea } from "./components/ui/scroll-area"
import { Skeleton } from "./components/ui/skeleton"
import imageTitles from "./data/image-titles.json";

const PERSONAL_API_KEY = process.env.REACT_APP_PERSONAL_API_KEY || "";
const ROOT_FOLDER_ID = "1l5AcNyxB9caGYiHMAuoI3AiBpltnis5T";

export interface InspirationItem {
  id: string;
  title: string;
  imageUrl: string;
  thumbnailUrl: string;
  dimensions: string;
  size: string;
  date: string;
  section: string;
  topic: string;
  tags: string[];
  rawSize: number;
}

interface SectionFolder {
  id: string;
  name: string;
  createdTime: string;
  count?: number;
}

// Design tokens — JS constants so they work regardless of CSS variable resolution
const BRAND        = '#4B7BF5';
const BRAND_SUBTLE = '#EEF2FF';

// 8px spacing scale
const SP = { 0.5: 4, 1: 8, 1.5: 12, 2: 16, 2.5: 20, 3: 24, 3.5: 28, 4: 32, 5: 40, 6: 48, 7: 56, 8: 64 } as const;
const px = (n: keyof typeof SP) => `${SP[n]}px`;

// Touch targets
const TOUCH_H  = '44px';
const TOUCH_PX = '12px';
const TOUCH_PY = '8px';

// Type scale
const TEXT = { title: '24px', title2: '18px', base: '16px', sm: '14px', xs: '12px' } as const;

const getIconForSection = (name: string) => {
  const n = name.toLowerCase();
  if (n.includes('template')) return <LayoutTemplate className="w-4 h-4" />;
  if (n.includes('style') || n.includes('design')) return <Palette className="w-4 h-4" />;
  if (n.includes('pattern') || n.includes('ux')) return <MousePointerClick className="w-4 h-4" />;
  if (n.includes('interaction')) return <Sparkles className="w-4 h-4" />;
  return <Folder className="w-4 h-4" />;
};

function App() {
  const [items, setItems] = useState<InspirationItem[]>([]);
  const [sections, setSections] = useState<SectionFolder[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSection, setSelectedSection] = useState("All");
  const [loading, setLoading] = useState(true);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 800);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 800);

  // Static pre-built data state
  const [allStaticItems, setAllStaticItems] = useState<InspirationItem[] | null>(null);
  const [displayLimit, setDisplayLimit] = useState(24);
  const [selectedItem, setSelectedItem] = useState<InspirationItem | null>(null);
  const [imageLoading, setImageLoading] = useState(true);

  useEffect(() => {
    if (selectedItem) {
      setImageLoading(true);
    }
  }, [selectedItem]);



  // Reset pagination limit on search or collection changes
  useEffect(() => {
    setDisplayLimit(24);
  }, [selectedSection, searchQuery]);

  useEffect(() => {
    let prevWidth = window.innerWidth;
    const handleResize = () => {
      const currentWidth = window.innerWidth;
      setIsMobile(currentWidth < 800);
      const isLarge = currentWidth >= 800;
      const wasLarge = prevWidth >= 800;
      
      if (isLarge !== wasLarge) {
        setSidebarOpen(isLarge);
      }
      prevWidth = currentWidth;
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- GOOGLE DRIVE DATA FETCHING ---
  const fetchDriveData = useCallback(async (pageToken: string | null = null, isLoadMore = false) => {
    if (allStaticItems) return; // Prevent live fetching if static data is loaded
    setLoading(true);
    try {
      // 1. Fetch Folders (Sections)
      let currentSections = sections;
      if (!isLoadMore && currentSections.length === 0) {
        const folderResponse = await fetch(
          `https://www.googleapis.com/drive/v3/files?q='${ROOT_FOLDER_ID}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&key=${PERSONAL_API_KEY}&fields=files(id,name,createdTime)&pageSize=100`
        );
        const folderData = await folderResponse.json();
        currentSections = folderData.files || [];
        setSections(currentSections);
      }

      let fileData: any = {};
      const folderMap: Record<string, string> = {};
      currentSections.forEach((f: any) => { folderMap[f.id] = f.name; });
      folderMap[ROOT_FOLDER_ID] = "General";

      if (selectedSection === "All") {
        if (isLoadMore) {
          setLoading(false);
          return;
        }
        const allParentIds = [ROOT_FOLDER_ID, ...currentSections.map(s => s.id)];
        const promises = allParentIds.map(id => {
          let folderQuery = `trashed=false and mimeType contains 'image/' and '${id}' in parents`;
          return fetch(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(folderQuery)}&key=${PERSONAL_API_KEY}&fields=files(id,name,size,imageMediaMetadata,createdTime,parents,thumbnailLink,webContentLink)&pageSize=50`
          ).then(r => r.ok ? r.json() : {files: []}).catch(() => ({files: []}));
        });

        const results = await Promise.all(promises);
        fileData.files = results.flatMap(r => r.files || []);
        fileData.nextPageToken = null;
      } else {
        let query = `trashed=false and mimeType contains 'image/'`;
        if (selectedSection === "General") { 
          query += ` and '${ROOT_FOLDER_ID}' in parents`;
        } else {
          const targetFolder = currentSections.find(s => s.name === selectedSection);
          query += ` and '${targetFolder ? targetFolder.id : ROOT_FOLDER_ID}' in parents`;
        }
        const fileResponse = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&key=${PERSONAL_API_KEY}&fields=nextPageToken,files(id,name,size,imageMediaMetadata,createdTime,parents,thumbnailLink,webContentLink)&pageSize=24${pageToken ? `&pageToken=${pageToken}` : ''}`
        );
        fileData = await fileResponse.json();
      }

      const newInspirationItems: InspirationItem[] = (fileData.files || []).map((file: any) => {
        const sizeInMB = file.size ? (parseInt(file.size) / (1024 * 1024)).toFixed(1) : "0.0";
        let thumbUrl = file.thumbnailLink ? file.thumbnailLink.replace(/=s\d+.*$/, "=w800") : `https://drive.google.com/thumbnail?id=${file.id}&sz=w800`;
        let imageUrl = file.thumbnailLink ? file.thumbnailLink.replace(/=s\d+.*$/, "=w1600") : `https://drive.google.com/thumbnail?id=${file.id}&sz=w1600`;
        const parentId = file.parents?.[0];
        const sectionName = folderMap[parentId] || "General";

        return {
          id: file.id,
          title: (imageTitles as Record<string, string>)[file.id] || file.name.split('.')[0],
          imageUrl: imageUrl,
          thumbnailUrl: thumbUrl,
          dimensions: file.imageMediaMetadata ? `${file.imageMediaMetadata.width} × ${file.imageMediaMetadata.height}` : "Original",
          size: `${sizeInMB} MB`,
          date: new Date(file.createdTime).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
          }),
          section: sectionName, 
          topic: "Inspiration",
          tags: ["Drive", sectionName],
          rawSize: file.size ? parseInt(file.size) : 0
        };
      });

      if (isLoadMore) {
        setItems(prev => [...prev, ...newInspirationItems]);
      } else {
        setItems(newInspirationItems);
      }
      setNextPageToken(fileData.nextPageToken || null);
    } catch (error) {
      console.error("Error fetching Drive data:", error);
    } finally {
      setLoading(false);
    }
  }, [selectedSection, sections, allStaticItems]);

  useEffect(() => {
    const loadStaticData = async () => {
      try {
        const res = await fetch('./inspiration-data.json');
        if (res.ok) {
          const data = await res.json();
          if (data && data.items && data.sections) {
            setSections(data.sections);
            setAllStaticItems(data.items);
            setLoading(false);
            console.log("Loaded Google Drive data from static build JSON.");
            return;
          }
        }
      } catch (e) {
        console.log("Static JSON not found or failed to load. Falling back to live Google Drive API.", e);
      }
      
      // Fallback to live API fetch
      fetchDriveData();
    };
    
    loadStaticData();
  }, [fetchDriveData]);

  const filteredItems = useMemo(() => {
    const sourceItems = allStaticItems || items;
    return sourceItems.filter(item => {
      const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            item.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesSection = selectedSection === "All" || item.section === selectedSection;
      return matchesSearch && matchesSection;
    });
  }, [items, allStaticItems, searchQuery, selectedSection]);

  const currentIndex = useMemo(() => {
    if (!selectedItem) return -1;
    return filteredItems.findIndex(x => x.id === selectedItem.id);
  }, [filteredItems, selectedItem]);

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < filteredItems.length - 1;

  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      setSelectedItem(filteredItems[currentIndex - 1]);
    }
  }, [currentIndex, filteredItems]);

  const handleNext = useCallback(() => {
    if (currentIndex < filteredItems.length - 1 && currentIndex !== -1) {
      setSelectedItem(filteredItems[currentIndex + 1]);
    }
  }, [currentIndex, filteredItems]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedItem) return;
      if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItem, handlePrev, handleNext]);

  const displayedItems = useMemo(() => {
    return allStaticItems ? filteredItems.slice(0, displayLimit) : filteredItems;
  }, [filteredItems, allStaticItems, displayLimit]);

  const observer = useRef<IntersectionObserver | null>(null);
  const lastItemRef = useCallback((node: HTMLDivElement | null) => {
    if (loading) return;
    
    if (allStaticItems) {
      if (displayLimit >= filteredItems.length) return;
      if (observer.current) observer.current.disconnect();
      observer.current = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) {
          setDisplayLimit(prev => prev + 24);
        }
      });
      if (node) observer.current.observe(node);
    } else {
      if (!nextPageToken) return;
      if (observer.current) observer.current.disconnect();
      observer.current = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) {
          fetchDriveData(nextPageToken, true);
        }
      });
      if (node) observer.current.observe(node);
    }
  }, [loading, nextPageToken, fetchDriveData, allStaticItems, displayLimit, filteredItems.length]);

  const sectionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    const sourceItems = allStaticItems || items;
    sourceItems.forEach(item => { counts[item.section] = (counts[item.section] || 0) + 1; });
    return counts;
  }, [items, allStaticItems]);

  const sidebarW = sidebarOpen ? 400 : 64;

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden" style={{ fontFamily: 'Inter, system-ui, sans-serif', backgroundColor: 'var(--color-surface-primary)' }}>

      {/* ── Top Bar ──────────────────────────────────────────────────────────── */}
      <header
        className="shrink-0 border-b flex items-center justify-between bg-white z-20"
        style={{ height: px(8), borderColor: 'var(--color-border)', padding: `0 ${px(3)}` }}
      >
        {/* Logo — tracks sidebar width on desktop */}
        <div
          className="flex items-center overflow-hidden shrink-0 transition-all duration-200"
          style={{ width: isMobile ? 'auto' : sidebarW, gap: px(1), marginRight: isMobile ? px(2) : 0 }}
        >
          <div className="w-8 h-8 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: BRAND }}>
            <svg width="16" height="16" viewBox="0 0 32 32" fill="none"><path d="M16 2l14 14-14 14-14-14z" fill="white"/></svg>
          </div>
          {sidebarOpen && (
            <span className="truncate" style={{ fontFamily: 'Funnel Sans, system-ui, sans-serif', fontSize: TEXT.title2, fontWeight: 600, color: 'var(--color-fg-primary)' }}>
              Imagenie
            </span>
          )}
        </div>

        {/* Search */}
        <div className="flex-1 max-w-2xl px-2 sm:px-8 min-w-0">
          <div
            className="flex items-center w-full rounded-full transition-all"
            style={{ height: TOUCH_H, backgroundColor: 'var(--color-surface-main)', border: '1px solid var(--color-border)', padding: `0 ${px(2)}`, gap: px(1) }}
            onFocusCapture={e => (e.currentTarget.style.borderColor = 'var(--color-border-input)')}
            onBlurCapture={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
          >
            <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--color-fg-tertiary)' }} />
            <input
              className="flex-1 bg-transparent border-none outline-none placeholder:text-gray-400"
              style={{ fontSize: TEXT.base, color: 'var(--color-fg-primary)' }}
              placeholder="Search inspiration..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Right controls */}
        <button
          className="rounded-full bg-black flex items-center justify-center text-white font-semibold hover:bg-gray-800 transition-colors shrink-0 ml-2"
          style={{ width: TOUCH_H, height: TOUCH_H, fontSize: TEXT.sm }}
        >
          R
        </button>
      </header>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', height: 'calc(100vh - 64px)', overflow: 'hidden', position: 'relative' }}>

        {/* Mobile Backdrop */}
        {isMobile && sidebarOpen && (
          <div 
            className="fixed inset-0 bg-black/40 z-[998] transition-opacity"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* ── Sidebar ────────────────────────────────────────────────────────── */}
        <aside
          className={`shrink-0 border-r overflow-y-auto overflow-x-hidden transition-transform duration-300 ${isMobile ? 'fixed z-[999] bg-white' : ''}`}
          style={{
            height: '100%',
            width: isMobile ? 300 : sidebarW,
            left: 0,
            top: 0,
            transform: isMobile ? (sidebarOpen ? 'translateX(0)' : 'translateX(-100%)') : 'none',
            borderColor: 'var(--color-border)',
            backgroundColor: '#ffffff',
            padding: isMobile ? px(3) : (sidebarOpen ? px(3) : `${px(3)} ${px(1)}`),
            boxShadow: isMobile && sidebarOpen ? '4px 0 24px rgba(0,0,0,0.1)' : 'none'
          }}
        >
          {/* Sidebar header */}
          <div
            className="flex items-center shrink-0"
            style={{ justifyContent: sidebarOpen ? 'flex-start' : 'center', gap: px(1), marginBottom: px(3) }}
          >
            <button
              onClick={() => setSidebarOpen(o => !o)}
              className="rounded-md transition-colors hover:bg-gray-100"
              style={{ padding: TOUCH_PY, color: 'var(--color-fg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: TOUCH_H, minHeight: TOUCH_H }}
              title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
            </button>
            {sidebarOpen && (
              <h2 style={{ fontFamily: 'Funnel Sans, system-ui, sans-serif', fontSize: TEXT.base, fontWeight: 600, color: 'var(--color-fg-primary)' }}>
                Collections
              </h2>
            )}
          </div>

          {/* All Inspiration */}
          <button
            onClick={() => setSelectedSection("All")}
            className="flex items-center w-full rounded-lg transition-colors"
            style={{
              justifyContent: sidebarOpen ? 'space-between' : 'center',
              padding: sidebarOpen ? `${TOUCH_PY} ${TOUCH_PX}` : TOUCH_PY,
              minHeight: TOUCH_H,
              gap: px(1),
              fontSize: TEXT.sm,
              backgroundColor: selectedSection === "All" ? BRAND_SUBTLE : 'transparent',
              color: selectedSection === "All" ? BRAND : 'var(--color-fg-primary)',
              fontWeight: selectedSection === "All" ? 600 : 500,
            }}
            onMouseEnter={e => { if (selectedSection !== "All") e.currentTarget.style.backgroundColor = BRAND_SUBTLE; }}
            onMouseLeave={e => { if (selectedSection !== "All") e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            <div className="flex items-center" style={{ gap: px(1) }}>
              <LayoutGrid className="w-4 h-4 shrink-0" />
              {sidebarOpen && <span>All Inspiration</span>}
            </div>
            {sidebarOpen && (
              <span className="tabular-nums shrink-0" style={{ fontSize: TEXT.xs, opacity: 0.6, minWidth: 'fit-content' }}>{(allStaticItems || items).length}</span>
            )}
          </button>

          {/* Divider + categories (expanded only) */}
          {sidebarOpen ? (
            <>
              <div style={{ height: 1, backgroundColor: 'var(--color-border)', margin: `${px(3)} 0` }} />
              <div className="flex flex-col" style={{ gap: 4 }}>
                {sections.map(section => (
                  <button
                    key={section.id}
                    onClick={() => setSelectedSection(section.name)}
                    className="flex items-center w-full overflow-hidden rounded-lg transition-colors text-left"
                    style={{
                      gap: px(1),
                      padding: `${TOUCH_PY} ${TOUCH_PX}`,
                      minHeight: TOUCH_H,
                      fontSize: TEXT.sm,
                      backgroundColor: selectedSection === section.name ? BRAND_SUBTLE : 'transparent',
                      color: selectedSection === section.name ? BRAND : 'var(--color-fg-primary)',
                      fontWeight: selectedSection === section.name ? 600 : 500,
                    }}
                    onMouseEnter={e => { if (selectedSection !== section.name) e.currentTarget.style.backgroundColor = BRAND_SUBTLE; }}
                    onMouseLeave={e => { if (selectedSection !== section.name) e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <span className="shrink-0">{getIconForSection(section.name)}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{section.name}</span>
                    {sectionCounts[section.name] ? (
                      <span className="shrink-0 tabular-nums" style={{ fontSize: TEXT.xs, opacity: 0.6 }}>{sectionCounts[section.name]}</span>
                    ) : null}
                  </button>
                ))}
              </div>

            </>
          ) : (
            /* Collapsed — icon-only category list */
            <div className="flex flex-col items-center" style={{ gap: 4, marginTop: px(2) }}>
              {sections.map(section => (
                <button
                  key={section.id}
                  onClick={() => setSelectedSection(section.name)}
                  className={`rounded-lg transition-colors flex items-center justify-center ${selectedSection === section.name ? 'bg-gray-100' : 'hover:bg-gray-100'}`}
                  style={{ width: TOUCH_H, height: TOUCH_H, color: 'var(--color-fg-secondary)' }}
                  title={section.name}
                >
                  {getIconForSection(section.name)}
                </button>
              ))}
            </div>
          )}
        </aside>

        {/* ── Main content ─────────────────────────────────────────────────────── */}
        <main style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: 'var(--color-surface-main)' }}>

          {/* Content header */}
          <div
            className={`shrink-0 flex ${isMobile ? 'flex-col items-start' : 'items-center justify-between'} bg-white border-b`}
            style={{ borderColor: 'var(--color-border)', padding: `${px(3)} ${px(4)}` }}
          >
            <div className="flex items-center">
              {isMobile && (
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="rounded-md hover:bg-gray-100 flex items-center justify-center mr-3 shrink-0"
                  style={{ width: TOUCH_H, height: TOUCH_H, color: 'var(--color-fg-primary)' }}
                >
                  <PanelLeftOpen className="w-6 h-6" />
                </button>
              )}
              <div className="flex flex-col">
                <h1 style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '32px', fontWeight: 700, color: 'var(--color-fg-primary)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                  {selectedSection === "All" ? "All Inspiration" : selectedSection}
                </h1>
                {isMobile && (
                  <span className="tabular-nums mt-1" style={{ fontSize: TEXT.sm, color: '#6b7a8d' }}>
                    {filteredItems.length} items
                  </span>
                )}
              </div>
            </div>
            {!isMobile && (
              <span className="tabular-nums shrink-0" style={{ fontSize: TEXT.sm, color: '#6b7a8d', minWidth: 'fit-content' }}>
                {filteredItems.length} items
              </span>
            )}
          </div>

          {/* Scrollable grid */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <div style={{ padding: px(3) }}>

              {/* Skeleton */}
              {loading && filteredItems.length === 0 && (
                <div className="inspiration-grid" style={{ gap: px(2) }}>
                  {Array.from({ length: 16 }).map((_, i) => (
                    <div key={i} className="bg-white rounded-xl overflow-hidden border" style={{ borderColor: 'var(--color-border)' }}>
                      <Skeleton className="w-full aspect-video" />
                      <div style={{ padding: px(2), display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <Skeleton className="h-4 w-3/4 rounded" />
                        <Skeleton className="h-3 w-1/3 rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Cards */}
              <div className="inspiration-grid" style={{ gap: px(2) }}>
                {displayedItems.map((item, index) => {
                  const isLast = displayedItems.length === index + 1;
                  return (
                    <InspirationCard
                      key={item.id}
                      item={item}
                      ref={isLast ? lastItemRef : null}
                      onClick={() => setSelectedItem(item)}
                    />
                  );
                })}
              </div>

              {/* Paginating spinner */}
              {loading && filteredItems.length > 0 && (
                <div className="flex justify-center items-center" style={{ padding: `${px(4)} 0` }}>
                  <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--color-fg-tertiary)' }} />
                </div>
              )}

              {/* Empty state */}
              {!loading && filteredItems.length === 0 && (
                <div className="flex flex-col items-center justify-center" style={{ padding: `${px(8)} 0`, color: 'var(--color-fg-tertiary)' }}>
                  <Search className="w-10 h-10 mb-3 opacity-20" />
                  <p style={{ fontSize: TEXT.sm, fontWeight: 500 }}>No inspiration found</p>
                  <p style={{ fontSize: TEXT.xs, marginTop: 4, opacity: 0.7 }}>Try a different search or category</p>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Lightbox Modal (Node ID: BCvqL -> Modal Container: sO9Fq) */}
      <Dialog open={selectedItem !== null} onOpenChange={(open) => !open && setSelectedItem(null)}>
        {selectedItem && (
          <DialogContent className="max-w-[1100px] w-[95vw] h-[85vh] p-0 border-none rounded-2xl overflow-y-auto flex flex-col gap-0 bg-white">
            <DialogHeader className="sr-only">
              <DialogTitle>{selectedItem.title}</DialogTitle>
            </DialogHeader>

            {/* Top: Image Preview */}
            <div className="shrink-0 flex items-center justify-center relative p-8" style={{ height: '55vh', minHeight: '300px', backgroundColor: 'var(--color-surface-main)' }}>
              {/* Left Navigation Arrow */}
              {hasPrev && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePrev();
                  }}
                  className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/95 hover:bg-white border flex items-center justify-center transition-all cursor-pointer z-10"
                  style={{ borderColor: 'var(--color-border)', outline: 'none' }}
                  aria-label="Previous image"
                >
                  <ChevronLeft className="w-5 h-5" style={{ color: 'var(--color-fg-primary)' }} />
                </button>
              )}

              {/* Right Navigation Arrow */}
              {hasNext && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleNext();
                  }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/95 hover:bg-white border flex items-center justify-center transition-all cursor-pointer z-10"
                  style={{ borderColor: 'var(--color-border)', outline: 'none' }}
                  aria-label="Next image"
                >
                  <ChevronRight className="w-5 h-5" style={{ color: 'var(--color-fg-primary)' }} />
                </button>
              )}

              {imageLoading && (
                <Skeleton className="w-full h-full rounded-xl" />
              )}
              <img
                src={selectedItem.imageUrl}
                alt={selectedItem.title}
                className={`w-full h-full object-contain drop-shadow-xl ${imageLoading ? 'opacity-0 absolute' : 'opacity-100'}`}
                referrerPolicy="no-referrer"
                onLoad={() => setImageLoading(false)}
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  if (!target.src.includes('/u/0/d/')) {
                    target.src = `https://lh3.googleusercontent.com/u/0/d/${selectedItem.id}`;
                  } else {
                    setImageLoading(false);
                  }
                }}
              />
            </div>

            {/* Bottom: Details Panel */}
            <div className="shrink-0 flex flex-col" style={{ width: '100%', padding: `${px(2)} ${px(3)} ${px(3)} ${px(3)}`, backgroundColor: 'var(--color-surface-primary)', gap: px(3) }}>
              {imageLoading ? (
                <Skeleton className="h-6 w-48 rounded" />
              ) : (
                <h2 className="font-semibold leading-snug break-words" style={{ fontFamily: 'Funnel Sans, system-ui, sans-serif', fontSize: TEXT.title2, color: 'var(--color-fg-primary)' }}>{selectedItem.title}</h2>
              )}

              <div style={{ display: 'flex', flexWrap: 'nowrap', justifyContent: 'space-between', gap: '16px' }}>
                {/* Column 1: Category & Dimensions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {imageLoading ? (
                      <Skeleton className="h-3 w-16 rounded mb-1" />
                    ) : (
                      <span className="font-semibold uppercase tracking-widest" style={{ fontSize: TEXT.xs, color: 'var(--color-fg-tertiary)' }}>Category</span>
                    )}
                    {imageLoading ? (
                      <Skeleton className="h-4 w-32 rounded" />
                    ) : (
                      <span className="font-medium tabular-nums" style={{ fontSize: TEXT.sm, color: 'var(--color-fg-primary)' }}>{selectedItem.section}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {imageLoading ? (
                      <Skeleton className="h-3 w-20 rounded mb-1" />
                    ) : (
                      <span className="font-semibold uppercase tracking-widest" style={{ fontSize: TEXT.xs, color: 'var(--color-fg-tertiary)' }}>Dimensions</span>
                    )}
                    {imageLoading ? (
                      <Skeleton className="h-4 w-24 rounded" />
                    ) : (
                      <span className="font-medium tabular-nums" style={{ fontSize: TEXT.sm, color: 'var(--color-fg-primary)' }}>{selectedItem.dimensions}</span>
                    )}
                  </div>
                </div>

                {/* Column 2: Size & Added */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {imageLoading ? (
                      <Skeleton className="h-3 w-10 rounded mb-1" />
                    ) : (
                      <span className="font-semibold uppercase tracking-widest" style={{ fontSize: TEXT.xs, color: 'var(--color-fg-tertiary)' }}>Size</span>
                    )}
                    {imageLoading ? (
                      <Skeleton className="h-4 w-16 rounded" />
                    ) : (
                      <span className="font-medium tabular-nums" style={{ fontSize: TEXT.sm, color: 'var(--color-fg-primary)' }}>{selectedItem.size}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {imageLoading ? (
                      <Skeleton className="h-3 w-12 rounded mb-1" />
                    ) : (
                      <span className="font-semibold uppercase tracking-widest" style={{ fontSize: TEXT.xs, color: 'var(--color-fg-tertiary)' }}>Added</span>
                    )}
                    {imageLoading ? (
                      <Skeleton className="h-4 w-28 rounded" />
                    ) : (
                      <span className="font-medium tabular-nums" style={{ fontSize: TEXT.sm, color: 'var(--color-fg-primary)' }}>{selectedItem.date}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

// Component/Thumbnail Card (Node ID: H3GS5)
const InspirationCard = React.forwardRef<HTMLDivElement, { item: InspirationItem; onClick?: () => void }>(({ item, onClick }, ref) => {
  return (
    <div
      ref={ref}
      onClick={onClick}
      className="group flex flex-col w-full bg-white rounded-xl overflow-hidden cursor-pointer border transition-all duration-200"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <div className="relative overflow-hidden" style={{ paddingTop: '62.5%', backgroundColor: 'var(--color-surface-main)' }}>
        <img
          src={item.thumbnailUrl}
          alt={item.title}
          className="absolute inset-0 w-full h-full object-cover"
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            if (!target.src.includes('/u/0/d/')) {
              target.src = `https://lh3.googleusercontent.com/u/0/d/${item.id}`;
            }
          }}
        />
        <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
          <Eye className="w-6 h-6 text-white drop-shadow-md" />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', padding: px(2), gap: 4 }}>
        <h3 className="truncate font-medium" style={{ fontSize: TEXT.sm, color: 'var(--color-fg-primary)' }}>{item.title}</h3>
        <div className="flex items-center justify-between">
          <span className="font-semibold" style={{ fontSize: TEXT.xs, color: BRAND }}>{item.section}</span>
        </div>
      </div>
    </div>
  );
});

export default App;