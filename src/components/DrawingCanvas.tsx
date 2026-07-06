import React, { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Save, Download, Play, Pause, Layers, Paintbrush,
  SlidersHorizontal, Trash2
} from 'lucide-react';
import { Artwork, BrushSettings, Layer, PaperSettings } from '../types';
import { BrushEngine } from '../utils/brushEngine';
import { FluidSimulator, ImpastoEngine } from '../utils/fluidDynamics';
import { createGrainField, loadPaperScanTexture, PaperGrainField, ScanTexture } from '../utils/paperGrain';
import BrushPanel from './BrushPanel';
import ColorPanel from './ColorPanel';
import LayersPanel from './LayersPanel';

// Real scanned cold-press watercolor paper, used as the grain source for
// the rough_watercolor paper type instead of purely procedural noise.
const PAPER_SCAN_URL = '/paper-textures/arches-140-cold-press.jpg';

interface DrawingCanvasProps {
  artwork: Artwork;
  onBack: () => void;
  onSave: (artwork: Artwork, previewUrl: string) => void;
}

export default function DrawingCanvas({
  artwork,
  onBack,
  onSave,
}: DrawingCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Canvas Elements
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const paperCanvasRef = useRef<HTMLCanvasElement>(null);
  const compositeCanvasRef = useRef<HTMLCanvasElement>(null);

  // Drawing state
  const [activeLayerId, setActiveLayerId] = useState<string>(artwork.activeLayerId);
  const [layers, setLayers] = useState<Layer[]>(artwork.layers);
  const [paper, setPaper] = useState<PaperSettings>(artwork.paperSettings);
  const [isPainting, setIsPainting] = useState<boolean>(false);

  // Brush settings
  const [brushSettings, setBrushSettings] = useState<BrushSettings>({
    type: 'watercolor',
    size: 25,
    opacity: 0.8,
    fluidity: 0.75,
    paintLoad: 0.8,
    grainInfluence: 0.5,
    pressureSensitivity: 0.7,
    tiltInfluence: 0.5,
    color: '#e32636', // Cadmium Red default
  });

  // Engines
  const brushEngineRef = useRef<BrushEngine>(new BrushEngine());
  const fluidSimsRef = useRef<Record<string, FluidSimulator>>({});
  const impastoEnginesRef = useRef<Record<string, ImpastoEngine>>({});
  // Dry-media canvas: oil/charcoal/pastel/graphite/ink/marker paint directly onto this,
  // strokes accumulate here permanently.
  const layerCanvasesRef = useRef<Record<string, HTMLCanvasElement>>({});
  // Wet-media canvas: owned entirely by the fluid sim. Cleared and fully
  // redrawn from FluidSimulator state every tick — must stay separate from
  // layerCanvasesRef, or every fluid step wipes out dry-media strokes too.
  const fluidCanvasesRef = useRef<Record<string, HTMLCanvasElement>>({});

  // Paper grain: shared between fluid-sim physics and full-res visual rendering.
  const paperRef = useRef<PaperSettings>(paper);
  const scanTextureRef = useRef<ScanTexture | null>(null);
  const grainFieldRef = useRef<PaperGrainField>(createGrainField(paper, null));
  // Cached full-canvas-resolution height samples, so slider drags (light
  // angle/height) don't re-run noise evaluation on every tick.
  const grainHeightMapRef = useRef<Float32Array | null>(null);

  // Simulation controls
  const [fluidSimRunning, setFluidSimRunning] = useState<boolean>(true);
  const [lightAngle, setLightAngle] = useState<number>(135);
  const [lightHeight, setLightHeight] = useState<number>(0.5);
  const [fluidError, setFluidError] = useState<string | null>(null);

  // Floating tool panels (Procreate-style): only one open at a time. All chrome
  // fades out of the way while actively painting so the canvas is unobstructed.
  const [activePanel, setActivePanel] = useState<'brush' | 'color' | 'layers' | 'adjust' | null>(null);
  const togglePanel = (panel: 'brush' | 'color' | 'layers' | 'adjust') =>
    setActivePanel((cur) => (cur === panel ? null : panel));

  // Set up canvases and engines on mount or resize
  useEffect(() => {
    const width = artwork.width;
    const height = artwork.height;

    // Set sizes
    if (displayCanvasRef.current) {
      displayCanvasRef.current.width = width;
      displayCanvasRef.current.height = height;
    }
    if (paperCanvasRef.current) {
      paperCanvasRef.current.width = width;
      paperCanvasRef.current.height = height;
    }
    if (compositeCanvasRef.current) {
      compositeCanvasRef.current.width = width;
      compositeCanvasRef.current.height = height;
    }

    // Initialize/sync canvas for each layer
    layers.forEach((layer) => {
      if (!layerCanvasesRef.current[layer.id]) {
        const canv = document.createElement('canvas');
        canv.width = width;
        canv.height = height;
        layerCanvasesRef.current[layer.id] = canv;

        // Clear canvas with transparency
        const ctx = canv.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, width, height);
        }
      }

      if (!fluidCanvasesRef.current[layer.id]) {
        const fluidCanv = document.createElement('canvas');
        fluidCanv.width = width;
        fluidCanv.height = height;
        fluidCanvasesRef.current[layer.id] = fluidCanv;
      }

      // Initialize fluid/impasto engines
      if (!fluidSimsRef.current[layer.id]) {
        try {
          fluidSimsRef.current[layer.id] = new FluidSimulator(width, height, 2);
          fluidSimsRef.current[layer.id].generatePaperGrain(paper, grainFieldRef.current);
        } catch (err) {
          // WebGL2/float-target support missing: watercolor is unavailable,
          // dry media still work (they never touch the fluid sim).
          setFluidError(err instanceof Error ? err.message : String(err));
        }
      }
      if (!impastoEnginesRef.current[layer.id]) {
        impastoEnginesRef.current[layer.id] = new ImpastoEngine(width, height);
      }
    });

    computeGrainHeightMap(paper);
    renderPaperBackground();
    compositeCanvas();

    // Resize container layout to fit inside workspace cleanly
    const handleResize = () => {
      // Fluid resize of viewer container is handled by CSS flex/aspect ratios
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [artwork, layers.length]);

  // Keep a ref mirror of the latest paper settings for use in async callbacks.
  useEffect(() => {
    paperRef.current = paper;
  }, [paper]);

  // Free all GPU fluid resources on unmount (separate from the layer-sync
  // effect so it only runs when the editor actually closes).
  useEffect(() => {
    return () => {
      (Object.values(fluidSimsRef.current) as FluidSimulator[]).forEach((sim) => sim.dispose());
      fluidSimsRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!(import.meta as any).env?.DEV || !window.location.search.includes('fluidTest=1')) return;

    const testWindow = window as any;
    testWindow.__fluidTest = {
      isActive() {
        return (Object.values(fluidSimsRef.current) as FluidSimulator[]).some((sim) => sim.isActive());
      },
      paperSignature() {
        const map = grainHeightMapRef.current;
        if (!map) return null;
        const width = paperCanvasRef.current?.width ?? 0;
        const height = paperCanvasRef.current?.height ?? 0;
        if (!width || !height) return null;

        const samples: number[] = [];
        for (let y = 0.2; y <= 0.8; y += 0.2) {
          for (let x = 0.2; x <= 0.8; x += 0.2) {
            const sx = Math.min(width - 1, Math.max(0, Math.round(width * x)));
            const sy = Math.min(height - 1, Math.max(0, Math.round(height * y)));
            samples.push(map[sy * width + sx]);
          }
        }
        return samples;
      },
      measureStepDraw(size = 1200) {
        const sim = new FluidSimulator(size, size, 2);
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          sim.dispose();
          throw new Error('2D canvas unavailable for fluid test');
        }

        sim.generatePaperGrain(paperRef.current, grainFieldRef.current);
        sim.injectPaint(size / 2, size / 2, 32, 227, 38, 54, 0.7, 0.8);
        const started = performance.now();
        sim.step(paperRef.current);
        sim.drawToContext(ctx);
        const elapsed = performance.now() - started;
        sim.dispose();
        return elapsed;
      },
      getActiveSim() {
        const sim = fluidSimsRef.current[activeLayerId];
        return sim || null;
      },
    };

    return () => {
      if (testWindow.__fluidTest) {
        delete testWindow.__fluidTest;
      }
    };
  }, [paper, activeLayerId, layers]);

  // Handle Paper Settings changes
  useEffect(() => {
    rebuildGrainField(paper);
    // Regenerate grain for all fluid simulators
    (Object.values(fluidSimsRef.current) as FluidSimulator[]).forEach((sim) => {
      sim.generatePaperGrain(paper, grainFieldRef.current);
    });
    computeGrainHeightMap(paper);
    renderPaperBackground();
    compositeCanvas();
  }, [paper]);

  // Load the real paper scan once and swap it into the grain field when ready.
  useEffect(() => {
    let cancelled = false;

    loadPaperScanTexture(PAPER_SCAN_URL)
      .then((scan) => {
        if (cancelled) return;
        scanTextureRef.current = scan;
        rebuildGrainField(paperRef.current);
        (Object.values(fluidSimsRef.current) as FluidSimulator[]).forEach((sim) => {
          sim.generatePaperGrain(paperRef.current, grainFieldRef.current);
        });
        computeGrainHeightMap(paperRef.current);
        renderPaperBackground();
        compositeCanvas();
      })
      .catch((err) => {
        console.warn('Paper scan texture failed to load; using procedural grain instead.', err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Escape closes any open tool panel.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActivePanel(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Simulation Update Ticker
  useEffect(() => {
    let animationFrameId: number;

    const tick = () => {
      if (fluidSimRunning) {
        let updated = false;

        layers.forEach((layer) => {
          const sim = fluidSimsRef.current[layer.id];
          if (sim && layer.visible) {
            // GPU sim tracks its own wetness bound — no CPU array scans
            if (sim.isActive()) {
              sim.step(paper);
              // Render into the layer's dedicated fluid canvas, NOT the
              // dry-media canvas — that one holds oil/charcoal/ink/etc.
              // strokes that must persist across fluid steps.
              const fluidCanvas = fluidCanvasesRef.current[layer.id];
              const fluidCtx = fluidCanvas?.getContext('2d');
              if (fluidCtx) {
                fluidCtx.clearRect(0, 0, artwork.width, artwork.height);
                sim.drawToContext(fluidCtx);
              }
              updated = true;
            }
          }
        });

        if (updated) {
          compositeCanvas();
        }
      }
      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrameId);
  }, [layers, paper, fluidSimRunning]);

  /**
   * Rebuilds the shared grain field sampler from current paper settings
   * (and the paper scan texture, once loaded).
   */
  const rebuildGrainField = (currentPaper: PaperSettings) => {
    grainFieldRef.current = createGrainField(currentPaper, scanTextureRef.current);
  };

  /**
   * Pre-computes full-canvas-resolution grain heights once, so relief
   * shading (redrawn on every light-angle/height slider tick) is a cheap
   * array read instead of re-evaluating noise per pixel every tick.
   */
  const computeGrainHeightMap = (currentPaper: PaperSettings) => {
    const canvas = paperCanvasRef.current;
    if (!canvas) return;
    const w = canvas.width;
    const h = canvas.height;
    const field = grainFieldRef.current;
    const roughness = currentPaper.roughness;

    const map = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        map[y * w + x] = field.heightAt(x, y) * roughness;
      }
    }
    grainHeightMapRef.current = map;
  };

  /**
   * Renders the tactile paper background, with grain shadowing relief.
   * Samples the cached full-resolution grain height map directly, so paper
   * texture stays sharp regardless of the (lower-res) fluid sim grid.
   */
  const renderPaperBackground = () => {
    const canvas = paperCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Fill base color
    ctx.fillStyle = paper.color || '#faf8f5';
    ctx.fillRect(0, 0, w, h);

    // Apply relief shading using the cached full-res grain height map
    const heightMap = grainHeightMapRef.current;
    if (heightMap && heightMap.length === w * h) {
      const imgData = ctx.getImageData(0, 0, w, h);
      const data = imgData.data;

      const lightAngleRad = (lightAngle * Math.PI) / 180;
      const lx = Math.cos(lightAngleRad);
      const ly = Math.sin(lightAngleRad);
      const lz = lightHeight * 0.5;

      const grainDepth = paper.grainDepth * 25;

      for (let cy = 1; cy < h - 1; cy++) {
        for (let cx = 1; cx < w - 1; cx++) {
          const idx = (cy * w + cx) * 4;

          // Compute slope from grain heights
          const hW = heightMap[cy * w + (cx - 1)];
          const hE = heightMap[cy * w + (cx + 1)];
          const hN = heightMap[(cy - 1) * w + cx];
          const hS = heightMap[(cy + 1) * w + cx];

          const dx = hW - hE;
          const dy = hN - hS;

          // Dot product with light
          const dot = (dx * lx + dy * ly + lz) / Math.sqrt(dx * dx + dy * dy + lz * lz);
          const shadowFactor = (dot - 0.5) * grainDepth;

          data[idx] = Math.max(0, Math.min(255, data[idx] + shadowFactor));
          data[idx + 1] = Math.max(0, Math.min(255, data[idx + 1] + shadowFactor));
          data[idx + 2] = Math.max(0, Math.min(255, data[idx + 2] + shadowFactor));
        }
      }
      ctx.putImageData(imgData, 0, 0);
    }
  };

  /**
   * Composites paper and visible drawing layers onto display/interactive canvas.
   */
  const compositeCanvas = () => {
    const canvas = compositeCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Draw Paper background
    if (paperCanvasRef.current) {
      ctx.drawImage(paperCanvasRef.current, 0, 0);
    }

    // 2. Overlay each active/visible drawing layer
    layers.forEach((layer) => {
      if (!layer.visible) return;

      const layerCanvas = layerCanvasesRef.current[layer.id];
      const fluidCanvas = fluidCanvasesRef.current[layer.id];
      const impasto = impastoEnginesRef.current[layer.id];

      if (layerCanvas) {
        ctx.save();
        ctx.globalAlpha = layer.opacity;

        // Apply blend modes
        if (layer.blendMode === 'multiply') ctx.globalCompositeOperation = 'multiply';
        else if (layer.blendMode === 'screen') ctx.globalCompositeOperation = 'screen';
        else if (layer.blendMode === 'overlay') ctx.globalCompositeOperation = 'overlay';
        else ctx.globalCompositeOperation = 'source-over';

        // 2a. Wet media (watercolor washes) first, as the base layer content.
        if (fluidCanvas) {
          ctx.drawImage(fluidCanvas, 0, 0);
        }

        // 2b. Dry media (oil/charcoal/pastel/graphite/ink/marker) on top.
        const containsHeights = impasto && impasto.heightMap.some(h => h > 0.05);

        if (containsHeights) {
          // Setup offscreen canvas to render shaded paint
          const shadedCanvas = document.createElement('canvas');
          shadedCanvas.width = canvas.width;
          shadedCanvas.height = canvas.height;
          const shadedCtx = shadedCanvas.getContext('2d');

          if (shadedCtx) {
            const layerCtx = layerCanvas.getContext('2d');
            if (layerCtx) {
              impasto.renderShaded(layerCtx, shadedCtx, lightAngle, lightHeight);
              ctx.drawImage(shadedCanvas, 0, 0);
            }
          }
        } else {
          // Standard alpha rendering
          ctx.drawImage(layerCanvas, 0, 0);
        }

        ctx.restore();
      }
    });

    // 3. Render complete composited picture to active Display Canvas
    const dCtx = displayCanvasRef.current?.getContext('2d');
    if (dCtx && displayCanvasRef.current) {
      dCtx.clearRect(0, 0, displayCanvasRef.current.width, displayCanvasRef.current.height);
      dCtx.drawImage(canvas, 0, 0);
    }
  };

  /**
   * High-precision Pointer Event Listeners (stylus pressure/tilt).
   */
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = displayCanvasRef.current;
    if (!canvas) return;

    // A tap while a tool panel is open just dismisses it — it doesn't paint.
    if (activePanel) {
      setActivePanel(null);
      return;
    }

    // Standard draw
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Capture can fail for synthetic/stale pointers — drawing still works
    }
    setIsPainting(true);

    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;

    const pressure = e.pointerType === 'pen' ? e.pressure : 0.5;
    const tiltX = e.tiltX || 0;
    const tiltY = e.tiltY || 0;

    const activeCanvas = layerCanvasesRef.current[activeLayerId];
    const activeCtx = activeCanvas?.getContext('2d');
    const sim = fluidSimsRef.current[activeLayerId];
    const impasto = impastoEnginesRef.current[activeLayerId];

    if (activeCtx && impasto) {
      brushEngineRef.current.resetStroke();
      brushEngineRef.current.drawStrokeSegment(
        activeCtx,
        x,
        y,
        pressure,
        tiltX,
        tiltY,
        brushSettings,
        paper,
        sim ?? null,
        impasto,
        canvas.width,
        canvas.height,
        grainFieldRef.current
      );
      compositeCanvas();
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isPainting) return;

    const canvas = displayCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;

    const pressure = e.pointerType === 'pen' ? e.pressure : 0.5;
    const tiltX = e.tiltX || 0;
    const tiltY = e.tiltY || 0;

    const activeCanvas = layerCanvasesRef.current[activeLayerId];
    const activeCtx = activeCanvas?.getContext('2d');
    const sim = fluidSimsRef.current[activeLayerId];
    const impasto = impastoEnginesRef.current[activeLayerId];

    if (activeCtx && impasto) {
      brushEngineRef.current.drawStrokeSegment(
        activeCtx,
        x,
        y,
        pressure,
        tiltX,
        tiltY,
        brushSettings,
        paper,
        sim ?? null,
        impasto,
        canvas.width,
        canvas.height,
        grainFieldRef.current
      );
      compositeCanvas();
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPainting) {
      const canvas = displayCanvasRef.current;
      if (canvas?.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
      setIsPainting(false);
      brushEngineRef.current.resetStroke();
      compositeCanvas();
    }
  };

  // Layer Actions
  const handleAddLayer = () => {
    const newId = `layer-${Date.now()}`;
    const newLayer: Layer = {
      id: newId,
      name: `Layer ${layers.length + 1}`,
      visible: true,
      opacity: 1.0,
      blendMode: 'normal',
    };

    setLayers((prev) => [...prev, newLayer]);
    setActiveLayerId(newId);
  };

  const handleDeleteLayer = (id: string) => {
    if (layers.length <= 1) return;

    // Remove from engines (free GPU resources before dropping the reference)
    fluidSimsRef.current[id]?.dispose();
    delete layerCanvasesRef.current[id];
    delete fluidCanvasesRef.current[id];
    delete fluidSimsRef.current[id];
    delete impastoEnginesRef.current[id];

    const updated = layers.filter((l) => l.id !== id);
    setLayers(updated);

    if (activeLayerId === id) {
      setActiveLayerId(updated[updated.length - 1].id);
    }
  };

  const handleToggleLayerVisibility = (id: string) => {
    setLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l))
    );
  };

  const handleLayerOpacityChange = (id: string, opacity: number) => {
    setLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, opacity: opacity } : l))
    );
  };

  const handleClearCanvas = () => {
    if (confirm('Are you sure you want to clear the active layer? This cannot be undone.')) {
      const activeCanvas = layerCanvasesRef.current[activeLayerId];
      const activeCtx = activeCanvas?.getContext('2d');
      if (activeCtx) {
        activeCtx.clearRect(0, 0, artwork.width, artwork.height);
      }

      // The fluid canvas only gets redrawn by the tick loop while fluid is
      // "active" (has water). Clear it directly too, since sim.clear()
      // below zeroes the water and the tick loop would otherwise never
      // touch this canvas again to blank it.
      const fluidCanvas = fluidCanvasesRef.current[activeLayerId];
      const fluidCtx = fluidCanvas?.getContext('2d');
      if (fluidCtx) {
        fluidCtx.clearRect(0, 0, artwork.width, artwork.height);
      }

      const sim = fluidSimsRef.current[activeLayerId];
      if (sim) {
        sim.clear();
      }

      const impasto = impastoEnginesRef.current[activeLayerId];
      if (impasto) {
        impasto.clear();
      }

      compositeCanvas();
    }
  };

  const handleExportPNG = () => {
    const canvas = compositeCanvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${artwork.name || 'artwork'}.png`;
    a.click();
  };

  const handleSaveArtwork = () => {
    const canvas = compositeCanvasRef.current;
    if (!canvas) return;
    const previewUrl = canvas.toDataURL('image/jpeg', 0.85);

    // Save layer structures and settings back to drawing list
    const updatedArtwork: Artwork = {
      ...artwork,
      layers: layers,
      activeLayerId: activeLayerId,
      paperSettings: paper,
      updatedAt: Date.now(),
    };

    onSave(updatedArtwork, previewUrl);
  };

  // Shared styling for the top-toolbar icon buttons; `active` highlights the
  // button whose panel is currently open.
  const toolBtnCls = (active: boolean) =>
    `p-2 rounded-lg border transition-all cursor-pointer flex items-center justify-center ${
      active
        ? 'bg-white text-neutral-950 border-white'
        : 'bg-neutral-800/80 hover:bg-neutral-700 border-neutral-700/50 text-neutral-300 hover:text-white'
    }`;

  return (
    <div className="flex flex-col h-screen w-screen bg-neutral-950 text-white overflow-hidden relative">
      {/* Top toolbar — fades out of the way while painting */}
      <header
        className={`absolute top-0 inset-x-0 h-14 px-4 flex items-center justify-between z-30 transition-opacity duration-200 ${
          isPainting ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        {/* Left: back + title */}
        <div className="flex items-center gap-3 bg-neutral-900/80 backdrop-blur border border-neutral-800 rounded-xl pl-2 pr-3.5 py-1.5 shadow-lg">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-300 hover:text-white transition-all cursor-pointer"
            title="Back to gallery"
          >
            <ArrowLeft size={17} />
          </button>
          <div className="leading-tight">
            <h1 className="text-xs font-semibold tracking-wide truncate max-w-[180px]">{artwork.name}</h1>
            <p className="text-[9px] text-neutral-500 uppercase font-mono">{artwork.width} × {artwork.height}</p>
          </div>
        </div>

        {/* Right: actions + tools */}
        <div className="flex items-center gap-1.5 bg-neutral-900/80 backdrop-blur border border-neutral-800 rounded-xl px-1.5 py-1.5 shadow-lg">
          <button onClick={() => setFluidSimRunning(!fluidSimRunning)} className={toolBtnCls(false)} title={fluidSimRunning ? 'Pause fluid simulation' : 'Resume fluid simulation'}>
            {fluidSimRunning ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button onClick={handleExportPNG} className={toolBtnCls(false)} title="Export PNG">
            <Download size={15} />
          </button>
          <button onClick={handleSaveArtwork} className={toolBtnCls(false)} title="Save artwork">
            <Save size={15} />
          </button>

          <div className="w-px h-6 bg-neutral-700/60 mx-0.5" />

          <button onClick={() => togglePanel('adjust')} className={toolBtnCls(activePanel === 'adjust')} title="Paper & lighting">
            <SlidersHorizontal size={15} />
          </button>
          <button onClick={() => togglePanel('brush')} className={toolBtnCls(activePanel === 'brush')} title="Brushes">
            <Paintbrush size={15} />
          </button>
          <button onClick={() => togglePanel('color')} className={toolBtnCls(activePanel === 'color')} title="Color">
            <span
              className="w-4 h-4 rounded-full border border-white/40 shadow-inner"
              style={{ backgroundColor: brushSettings.color || '#e32636' }}
            />
          </button>
          <button onClick={() => togglePanel('layers')} className={toolBtnCls(activePanel === 'layers')} title="Layers">
            <Layers size={15} />
          </button>

          <div className="w-px h-6 bg-neutral-700/60 mx-0.5" />

          <button
            onClick={handleClearCanvas}
            className="p-2 rounded-lg border border-neutral-700/50 bg-neutral-800/80 text-neutral-400 hover:text-red-400 hover:border-red-500/40 hover:bg-red-950/30 transition-all cursor-pointer flex items-center justify-center"
            title="Clear active layer"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </header>

      {/* Watercolor engine unavailable warning */}
      {fluidError && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-amber-950/90 border border-amber-800 text-amber-200 text-xs px-4 py-2 rounded-lg z-30 shadow-lg max-w-[90%]">
          Watercolor is unavailable: {fluidError} Dry media (pencil, ink, charcoal, pastel, oil) still work.
        </div>
      )}

      {/* Main stage */}
      <div
        className="flex-1 relative overflow-hidden bg-neutral-950/40 select-none"
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Left rail: brush size + opacity (Procreate-style), fades while painting */}
        <div
          className={`absolute left-3 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-5 bg-neutral-900/80 backdrop-blur border border-neutral-800 rounded-full py-6 px-2.5 shadow-xl transition-opacity duration-200 ${
            isPainting ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          <div className="flex flex-col items-center gap-2">
            <span className="text-[8px] font-mono text-neutral-500 tracking-wider">SIZE</span>
            <div className="h-32 flex items-center justify-center">
              <input
                type="range" min="1" max="150" value={brushSettings.size}
                onChange={(e) => setBrushSettings({ ...brushSettings, size: parseInt(e.target.value) })}
                className="w-32 -rotate-90 accent-white cursor-pointer"
                title="Brush size"
              />
            </div>
            <span className="text-[9px] font-mono text-neutral-300 tabular-nums">{brushSettings.size}</span>
          </div>

          <div className="w-5 h-px bg-neutral-700/60" />

          <div className="flex flex-col items-center gap-2">
            <span className="text-[8px] font-mono text-neutral-500 tracking-wider">FLOW</span>
            <div className="h-32 flex items-center justify-center">
              <input
                type="range" min="0.05" max="1" step="0.01" value={brushSettings.opacity}
                onChange={(e) => setBrushSettings({ ...brushSettings, opacity: parseFloat(e.target.value) })}
                className="w-32 -rotate-90 accent-white cursor-pointer"
                title="Brush opacity"
              />
            </div>
            <span className="text-[9px] font-mono text-neutral-300 tabular-nums">{Math.round(brushSettings.opacity * 100)}</span>
          </div>
        </div>

        {/* Canvas centered */}
        <div className="w-full h-full flex items-center justify-center p-8">
          <div
            ref={containerRef}
            className="relative shadow-2xl rounded border border-neutral-800 max-w-full max-h-full aspect-square"
            style={{
              width: `${artwork.width}px`,
              height: `${artwork.height}px`,
              maxWidth: '100%',
              maxHeight: '100%',
            }}
          >
            {/* Background Paper texture render context */}
            <canvas ref={paperCanvasRef} className="absolute inset-0 pointer-events-none hidden" />

            {/* Offline Composite buffer context */}
            <canvas ref={compositeCanvasRef} className="absolute inset-0 pointer-events-none hidden" />

            {/* Render Display Canvas (receives composite buffer) */}
            <canvas
              ref={displayCanvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="absolute inset-0 w-full h-full cursor-crosshair bg-white touch-none shadow-inner"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>
        </div>

        {/* Floating tool panels (top-right, below the toolbar) */}
        <AnimatePresence>
          {activePanel && (
            <motion.div
              key={activePanel}
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ type: 'spring', damping: 24, stiffness: 320 }}
              className="absolute top-16 right-3 z-30"
            >
              {activePanel === 'brush' && (
                <BrushPanel brushSettings={brushSettings} setBrushSettings={setBrushSettings} onClose={() => setActivePanel(null)} />
              )}
              {activePanel === 'color' && (
                <ColorPanel brushSettings={brushSettings} setBrushSettings={setBrushSettings} onClose={() => setActivePanel(null)} />
              )}
              {activePanel === 'layers' && (
                <LayersPanel
                  layers={layers}
                  activeLayerId={activeLayerId}
                  setActiveLayerId={setActiveLayerId}
                  onAddLayer={handleAddLayer}
                  onDeleteLayer={handleDeleteLayer}
                  onToggleLayerVisibility={handleToggleLayerVisibility}
                  onLayerOpacityChange={handleLayerOpacityChange}
                  onClose={() => setActivePanel(null)}
                />
              )}
              {activePanel === 'adjust' && (
                <div className="w-[260px] bg-neutral-900/95 backdrop-blur-md border border-neutral-800 rounded-2xl shadow-2xl text-white overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800">
                    <span className="text-xs font-semibold tracking-wide">Paper & Light</span>
                    <button onClick={() => setActivePanel(null)} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors text-base leading-none">
                      ×
                    </button>
                  </div>
                  <div className="p-4 flex flex-col gap-3 text-[10px]">
                    <div className="flex flex-col gap-1">
                      <span className="text-neutral-500 font-mono">TEXTURE STYLE</span>
                      <select
                        value={paper.type}
                        onChange={(e) => {
                          const type = e.target.value as any;
                          let roughness = 0.4, absorption = 0.5, fiberScale = 0.3, grainDepth = 0.3;
                          if (type === 'rough_watercolor') { roughness = 0.8; absorption = 0.8; fiberScale = 0.55; grainDepth = 0.65; }
                          else if (type === 'smooth_hotpress') { roughness = 0.15; absorption = 0.45; fiberScale = 0.2; grainDepth = 0.15; }
                          else if (type === 'canvas_linen') { roughness = 0.65; absorption = 0.25; fiberScale = 0.7; grainDepth = 0.75; }
                          else if (type === 'smooth_layout') { roughness = 0.05; absorption = 0.1; fiberScale = 0.1; grainDepth = 0.05; }
                          setPaper({ ...paper, type, roughness, absorption, fiberScale, grainDepth });
                        }}
                        className="bg-neutral-800 border border-neutral-700 rounded-lg p-1.5 text-white font-sans text-[11px] cursor-pointer"
                      >
                        <option value="rough_watercolor">Rough Watercolor Paper</option>
                        <option value="smooth_hotpress">Smooth Hotpress Paper</option>
                        <option value="canvas_linen">Woven Linen Canvas</option>
                        <option value="smooth_layout">Smooth Layout Board</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1.5 border-t border-neutral-800/50 pt-2.5">
                      <div className="flex justify-between font-mono text-neutral-400">
                        <span>LIGHT ANGLE</span><span>{lightAngle}°</span>
                      </div>
                      <input
                        type="range" min="0" max="360" value={lightAngle}
                        onChange={(e) => { setLightAngle(parseInt(e.target.value)); renderPaperBackground(); compositeCanvas(); }}
                        className="w-full accent-white h-0.5 rounded-full cursor-pointer bg-neutral-700"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between font-mono text-neutral-400">
                        <span>LIGHT HEIGHT</span><span>{Math.round(lightHeight * 100)}%</span>
                      </div>
                      <input
                        type="range" min="0.1" max="1.0" step="0.05" value={lightHeight}
                        onChange={(e) => { setLightHeight(parseFloat(e.target.value)); renderPaperBackground(); compositeCanvas(); }}
                        className="w-full accent-white h-0.5 rounded-full cursor-pointer bg-neutral-700"
                      />
                    </div>

                    <p className="text-[9px] text-neutral-500 italic leading-relaxed border-t border-neutral-800/50 pt-2">
                      Move the virtual light to reveal impasto depth and paper grain relief.
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
