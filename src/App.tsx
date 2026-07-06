import React, { useState, useEffect } from 'react';
import { Artwork, CustomBrush, CustomPaper, CustomMedium, PaperType, PaperSettings } from './types';
import HomeScreen from './components/HomeScreen';
import DrawingCanvas from './components/DrawingCanvas';
import StudioPage from './components/StudioPage';

// Local storage key constants
const ARTWORKS_KEY = 'natural_media_studio_artworks_v1';
const BRUSHES_KEY = 'natural_media_studio_brushes_v1';
const PAPERS_KEY = 'natural_media_studio_papers_v1';
const MEDIUMS_KEY = 'natural_media_studio_mediums_v1';

// Pre-defined base paper structures
const BASE_PAPERS: Record<PaperType, PaperSettings> = {
  rough_watercolor: {
    id: 'rough_watercolor',
    name: 'Rough Watercolor Paper',
    type: 'rough_watercolor',
    roughness: 0.8,
    absorption: 0.8,
    fiberScale: 0.55,
    grainDepth: 0.65,
    color: '#faf7f2',
  },
  smooth_hotpress: {
    id: 'smooth_hotpress',
    name: 'Smooth Hotpress Paper',
    type: 'smooth_hotpress',
    roughness: 0.15,
    absorption: 0.45,
    fiberScale: 0.2,
    grainDepth: 0.15,
    color: '#fefefe',
  },
  canvas_linen: {
    id: 'canvas_linen',
    name: 'Woven Linen Canvas',
    type: 'canvas_linen',
    roughness: 0.65,
    absorption: 0.25,
    fiberScale: 0.7,
    grainDepth: 0.75,
    color: '#eae3d2',
  },
  sketchbook_grain: {
    id: 'sketchbook_grain',
    name: 'Sketchbook Grain Paper',
    type: 'sketchbook_grain',
    roughness: 0.35,
    absorption: 0.5,
    fiberScale: 0.3,
    grainDepth: 0.35,
    color: '#fdfaf2',
  },
  smooth_layout: {
    id: 'smooth_layout',
    name: 'Smooth Layout Board',
    type: 'smooth_layout',
    roughness: 0.05,
    absorption: 0.1,
    fiberScale: 0.1,
    grainDepth: 0.05,
    color: '#ffffff',
  },
};

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<'home' | 'canvas' | 'studio'>('home');
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [activeArtworkId, setActiveArtworkId] = useState<string | null>(null);

  // Studio Creations
  const [customBrushes, setCustomBrushes] = useState<CustomBrush[]>([]);
  const [customPapers, setCustomPapers] = useState<CustomPaper[]>([]);
  const [customMediums, setCustomMediums] = useState<CustomMedium[]>([]);

  // Load Initial State from Local Storage or bootstrap sample projects
  useEffect(() => {
    try {
      const storedArts = localStorage.getItem(ARTWORKS_KEY);
      const storedBrushes = localStorage.getItem(BRUSHES_KEY);
      const storedPapers = localStorage.getItem(PAPERS_KEY);
      const storedMediums = localStorage.getItem(MEDIUMS_KEY);

      if (storedArts) {
        setArtworks(JSON.parse(storedArts));
      } else {
        // Bootstrap beautiful sample physical paintings
        const sampleArtwork1: Artwork = {
          id: 'sample-watercolor-study',
          name: 'Watercolor Fluid Blend',
          width: 800,
          height: 800,
          layers: [
            { id: 'layer-1', name: 'Fluid Background Wash', visible: true, opacity: 0.95, blendMode: 'normal' },
            { id: 'layer-2', name: 'Detail Ink Overlays', visible: true, opacity: 1.0, blendMode: 'normal' },
          ],
          activeLayerId: 'layer-1',
          paperSettings: BASE_PAPERS.rough_watercolor,
          createdAt: Date.now() - 86400000,
          updatedAt: Date.now() - 3600000,
        };

        const sampleArtwork2: Artwork = {
          id: 'sample-oil-study',
          name: 'Impasto Oil Still Life',
          width: 800,
          height: 800,
          layers: [
            { id: 'layer-oil-1', name: 'Base Sketch Layers', visible: true, opacity: 0.7, blendMode: 'multiply' },
            { id: 'layer-oil-2', name: 'Thick Oil Impasto Paint', visible: true, opacity: 1.0, blendMode: 'normal' },
          ],
          activeLayerId: 'layer-oil-2',
          paperSettings: BASE_PAPERS.canvas_linen,
          createdAt: Date.now() - 172800000,
          updatedAt: Date.now() - 7200000,
        };

        setArtworks([sampleArtwork1, sampleArtwork2]);
      }

      if (storedBrushes) setCustomBrushes(JSON.parse(storedBrushes));
      if (storedPapers) setCustomPapers(JSON.parse(storedPapers));
      if (storedMediums) setCustomMediums(JSON.parse(storedMediums));
    } catch (e) {
      console.error('Error loading data from local storage', e);
    }
  }, []);

  // Save Artworks changes
  const saveAllArtworks = (updated: Artwork[]) => {
    setArtworks(updated);
    try {
      localStorage.setItem(ARTWORKS_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to save artworks to localStorage', e);
    }
  };

  // Create Artwork
  const handleCreateArtwork = (name: string, width: number, height: number, paperType: PaperType) => {
    const paper = BASE_PAPERS[paperType] || BASE_PAPERS.rough_watercolor;
    const newArt: Artwork = {
      id: `art-${Date.now()}`,
      name,
      width,
      height,
      layers: [
        { id: 'layer-base-1', name: 'Canvas Layer 1', visible: true, opacity: 1.0, blendMode: 'normal' }
      ],
      activeLayerId: 'layer-base-1',
      paperSettings: paper,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const updated = [newArt, ...artworks];
    saveAllArtworks(updated);
    setActiveArtworkId(newArt.id);
    setCurrentScreen('canvas');
  };

  // Delete Artwork
  const handleDeleteArtwork = (id: string) => {
    if (confirm('Are you absolutely sure you want to delete this canvas? This is irreversible.')) {
      const updated = artworks.filter((art) => art.id !== id);
      saveAllArtworks(updated);
      if (activeArtworkId === id) setActiveArtworkId(null);
    }
  };

  // Clone/Duplicate Artwork
  const handleCloneArtwork = (id: string) => {
    const source = artworks.find((art) => art.id === id);
    if (!source) return;

    const cloned: Artwork = {
      ...source,
      id: `art-clone-${Date.now()}`,
      name: `${source.name} (Copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const updated = [cloned, ...artworks];
    saveAllArtworks(updated);
  };

  // Save Artwork and Preview Thumbnail Base64
  const handleSaveActiveArtwork = (updatedArtwork: Artwork, previewUrl: string) => {
    const withPreview = { ...updatedArtwork, previewUrl };
    const updatedList = artworks.map((art) => (art.id === updatedArtwork.id ? withPreview : art));
    saveAllArtworks(updatedList);
    alert('Canvas project saved successfully!');
  };

  // Custom Pen/Brush Creation save
  const handleSaveBrush = (brush: CustomBrush) => {
    const updated = [brush, ...customBrushes];
    setCustomBrushes(updated);
    localStorage.setItem(BRUSHES_KEY, JSON.stringify(updated));
  };

  // Custom Paper fabrication save
  const handleSavePaper = (paper: CustomPaper) => {
    const updated = [paper, ...customPapers];
    setCustomPapers(updated);
    localStorage.setItem(PAPERS_KEY, JSON.stringify(updated));
  };

  // Custom Medium chemical synthesis save
  const handleSaveMedium = (medium: CustomMedium) => {
    const updated = [medium, ...customMediums];
    setCustomMediums(updated);
    localStorage.setItem(MEDIUMS_KEY, JSON.stringify(updated));
  };

  const activeArtwork = artworks.find((art) => art.id === activeArtworkId);

  return (
    <div className="w-full h-full min-h-screen bg-neutral-950">
      {currentScreen === 'home' && (
        <HomeScreen
          artworks={artworks}
          onCreateArtwork={handleCreateArtwork}
          onSelectArtwork={(id) => {
            setActiveArtworkId(id);
            setCurrentScreen('canvas');
          }}
          onDeleteArtwork={handleDeleteArtwork}
          onCloneArtwork={handleCloneArtwork}
          onEnterStudio={() => setCurrentScreen('studio')}
        />
      )}

      {currentScreen === 'canvas' && activeArtwork && (
        <DrawingCanvas
          artwork={activeArtwork}
          onBack={() => {
            setActiveArtworkId(null);
            setCurrentScreen('home');
          }}
          onSave={handleSaveActiveArtwork}
        />
      )}

      {currentScreen === 'studio' && (
        <StudioPage
          onBack={() => setCurrentScreen('home')}
          customBrushes={customBrushes}
          onSaveBrush={handleSaveBrush}
          customPapers={customPapers}
          onSavePaper={handleSavePaper}
          customMediums={customMediums}
          onSaveMedium={handleSaveMedium}
        />
      )}
    </div>
  );
}
