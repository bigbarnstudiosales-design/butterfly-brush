import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ArrowLeft, Sliders, Settings, Sparkles, Droplet, Layers, HelpCircle, 
  Trash2, Plus, PenTool, Check, Undo
} from 'lucide-react';
import { CustomBrush, CustomPaper, CustomMedium, BrushSettings, PaperSettings } from '../types';
import { BrushEngine } from '../utils/brushEngine';
import { FluidSimulator, ImpastoEngine } from '../utils/fluidDynamics';
import { createGrainField, PaperGrainField } from '../utils/paperGrain';

interface StudioPageProps {
  onBack: () => void;
  customBrushes: CustomBrush[];
  onSaveBrush: (brush: CustomBrush) => void;
  customPapers: CustomPaper[];
  onSavePaper: (paper: CustomPaper) => void;
  customMediums: CustomMedium[];
  onSaveMedium: (medium: CustomMedium) => void;
}

type StudioTab = 'pen' | 'paper' | 'medium';

export default function StudioPage({
  onBack,
  customBrushes,
  onSaveBrush,
  customPapers,
  onSavePaper,
  customMediums,
  onSaveMedium,
}: StudioPageProps) {
  const [activeTab, setActiveTab] = useState<StudioTab>('pen');

  // Pen Studio State
  const [brushName, setBrushName] = useState<string>('My Custom Sable');
  const [brushType, setBrushType] = useState<BrushSettings['type']>('watercolor');
  const [brushSize, setBrushSize] = useState<number>(30);
  const [brushOpacity, setBrushOpacity] = useState<number>(0.8);
  const [brushFluidity, setBrushFluidity] = useState<number>(0.7);
  const [brushPaintLoad, setBrushPaintLoad] = useState<number>(0.85);
  const [pressureSens, setPressureSens] = useState<number>(0.6);
  const [tiltInfluence, setTiltInfluence] = useState<number>(0.5);

  // Paper Studio State
  const [paperName, setPaperName] = useState<string>('My Rough Cotton');
  const [paperRoughness, setPaperRoughness] = useState<number>(0.75);
  const [paperAbsorption, setPaperAbsorption] = useState<number>(0.6);
  const [fiberScale, setFiberScale] = useState<number>(0.45);
  const [grainDepth, setGrainDepth] = useState<number>(0.5);
  const [paperColor, setPaperColor] = useState<string>('#faf7f2');

  // Medium Studio State
  const [mediumName, setMediumName] = useState<string>('Glazing Dammar Medium');
  const [viscosity, setViscosity] = useState<number>(0.4);
  const [dryingRate, setDryingRate] = useState<number>(0.2);
  const [granularity, setGranularity] = useState<number>(0.8);
  const [binderRatio, setBinderRatio] = useState<number>(0.6);

  // Scratchpad Drawing Area
  const scratchCanvasRef = useRef<HTMLCanvasElement>(null);
  const scratchEngineRef = useRef<BrushEngine>(new BrushEngine());
  const scratchFluidSimRef = useRef<FluidSimulator | null>(null);
  const scratchImpastoRef = useRef<ImpastoEngine | null>(null);
  const scratchGrainFieldRef = useRef<PaperGrainField | null>(null);
  const [isDrawingScratch, setIsDrawingScratch] = useState<boolean>(false);
  const [scratchLightAngle, setScratchLightAngle] = useState<number>(135);

  // Sync scratchpad sizing and engines
  useEffect(() => {
    const canvas = scratchCanvasRef.current;
    if (!canvas) return;
    canvas.width = 320;
    canvas.height = 320;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#faf8f5';
      ctx.fillRect(0, 0, 320, 320);
    }

    // Free the previous sim's GPU resources — this effect re-runs on every
    // paper slider change and would otherwise leak textures/FBOs.
    scratchFluidSimRef.current?.dispose();
    try {
      scratchFluidSimRef.current = new FluidSimulator(320, 320, 2);
    } catch (err) {
      console.warn('Watercolor engine unavailable in studio scratchpad:', err);
      scratchFluidSimRef.current = null;
    }
    scratchImpastoRef.current = new ImpastoEngine(320, 320);

    const activePaperSettings: PaperSettings = {
      id: 'scratch',
      name: 'scratch-paper',
      type: 'rough_watercolor',
      roughness: paperRoughness,
      absorption: paperAbsorption,
      fiberScale: fiberScale,
      grainDepth: grainDepth,
      color: paperColor,
    };
    scratchGrainFieldRef.current = createGrainField(activePaperSettings, null);
    scratchFluidSimRef.current?.generatePaperGrain(activePaperSettings, scratchGrainFieldRef.current);
  }, [paperRoughness, fiberScale, paperColor]);

  // Free scratchpad GPU resources when leaving the studio page.
  useEffect(() => {
    return () => {
      scratchFluidSimRef.current?.dispose();
      scratchFluidSimRef.current = null;
    };
  }, []);

  // Fluid tick for scratchpad
  useEffect(() => {
    let intervalId: any;

    const tick = () => {
      const sim = scratchFluidSimRef.current;
      const canvas = scratchCanvasRef.current;
      const ctx = canvas?.getContext('2d');

      if (sim && canvas && ctx) {
        if (sim.isActive()) {
          const mockPaper: PaperSettings = {
            id: 'scratch',
            name: 'scratch',
            type: 'rough_watercolor',
            roughness: paperRoughness,
            absorption: paperAbsorption,
            fiberScale: fiberScale,
            grainDepth: grainDepth,
            color: paperColor,
          };

          sim.step(mockPaper);
          ctx.fillStyle = paperColor;
          ctx.fillRect(0, 0, 320, 320);
          sim.drawToContext(ctx);
        }
      }
    };

    intervalId = setInterval(tick, 30);
    return () => clearInterval(intervalId);
  }, [paperRoughness, paperAbsorption, fiberScale, grainDepth, paperColor]);

  const handleScratchPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = scratchCanvasRef.current;
    if (!canvas) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Capture can fail for synthetic/stale pointers — drawing still works
    }
    setIsDrawingScratch(true);

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    drawScratchPoint(x, y, e.pressure || 0.5);
  };

  const handleScratchPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingScratch) return;
    const canvas = scratchCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    drawScratchPoint(x, y, e.pressure || 0.5);
  };

  const handleScratchPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isDrawingScratch) {
      if (scratchCanvasRef.current?.hasPointerCapture(e.pointerId)) {
        scratchCanvasRef.current.releasePointerCapture(e.pointerId);
      }
      setIsDrawingScratch(false);
      scratchEngineRef.current.resetStroke();
    }
  };

  const drawScratchPoint = (x: number, y: number, pressure: number) => {
    const canvas = scratchCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    const sim = scratchFluidSimRef.current;
    const impasto = scratchImpastoRef.current;

    if (canvas && ctx && impasto && scratchGrainFieldRef.current) {
      const activeBrush: BrushSettings = {
        type: brushType,
        size: brushSize,
        opacity: brushOpacity,
        fluidity: brushFluidity,
        paintLoad: brushPaintLoad,
        grainInfluence: 0.5,
        pressureSensitivity: pressureSens,
        tiltInfluence: tiltInfluence,
        color: '#3498db', // Scratch blue color
      };

      const mockPaper: PaperSettings = {
        id: 'scratch',
        name: 'scratch',
        type: 'rough_watercolor',
        roughness: paperRoughness,
        absorption: paperAbsorption,
        fiberScale: fiberScale,
        grainDepth: grainDepth,
        color: paperColor,
      };

      scratchEngineRef.current.drawStrokeSegment(
        ctx,
        x,
        y,
        pressure,
        0,
        0,
        activeBrush,
        mockPaper,
        sim ?? null,
        impasto,
        320,
        320,
        scratchGrainFieldRef.current
      );
    }
  };

  const handleClearScratch = () => {
    const canvas = scratchCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.fillStyle = paperColor;
      ctx.fillRect(0, 0, 320, 320);
    }
    scratchFluidSimRef.current?.clear();
    scratchImpastoRef.current?.clear();
  };

  // Form Saving Actions
  const handleSaveBrushClick = () => {
    const brush: CustomBrush = {
      id: `brush-${Date.now()}`,
      name: brushName,
      settings: {
        type: brushType,
        size: brushSize,
        opacity: brushOpacity,
        fluidity: brushFluidity,
        paintLoad: brushPaintLoad,
        grainInfluence: 0.5,
        pressureSensitivity: pressureSens,
        tiltInfluence: tiltInfluence,
        color: '#e32636',
      },
      isCustom: true,
    };
    onSaveBrush(brush);
    alert(`Brush "${brushName}" successfully crafted and added to studio!`);
  };

  const handleSavePaperClick = () => {
    const paper: CustomPaper = {
      id: `paper-${Date.now()}`,
      name: paperName,
      settings: {
        id: `paper-${Date.now()}`,
        name: paperName,
        type: 'rough_watercolor',
        roughness: paperRoughness,
        absorption: paperAbsorption,
        fiberScale: fiberScale,
        grainDepth: grainDepth,
        color: paperColor,
      },
      isCustom: true,
    };
    onSavePaper(paper);
    alert(`Paper surface texture "${paperName}" successfully fabricated!`);
  };

  const handleSaveMediumClick = () => {
    const medium: CustomMedium = {
      id: `medium-${Date.now()}`,
      name: mediumName,
      viscosity,
      dryingRate,
      granularity,
      binderRatio,
      isCustom: true,
    };
    onSaveMedium(medium);
    alert(`Chemical Medium mixture "${mediumName}" successfully synthesized!`);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-neutral-950 text-white overflow-hidden font-sans">
      
      {/* Header */}
      <header className="h-16 border-b border-neutral-800 bg-neutral-900 px-6 flex items-center gap-4 z-10">
        <button
          onClick={onBack}
          className="p-2 rounded-full hover:bg-neutral-800 text-neutral-300 hover:text-white transition-all cursor-pointer"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-base font-bold flex items-center gap-2">
            Physical Media Creator Studios <Sparkles size={16} className="text-yellow-400" />
          </h1>
          <p className="text-[10px] text-neutral-500 uppercase font-mono tracking-wider">
            Engineer customized pens, papers, and chemical painting mediums
          </p>
        </div>
      </header>

      {/* Main Studio Splits */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Left Side: Controls & Sliders */}
        <div className="w-full md:w-[480px] border-r border-neutral-800 flex flex-col overflow-y-auto bg-neutral-900/40 p-6 space-y-6">
          
          {/* Studio Tab Buttons */}
          <div className="flex bg-neutral-900 p-1 rounded-lg border border-neutral-800">
            <button
              onClick={() => setActiveTab('pen')}
              className={`flex-1 py-2 text-xs font-bold rounded transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'pen' ? 'bg-neutral-800 text-white shadow' : 'text-neutral-400 hover:text-white'
              }`}
            >
              <PenTool size={13} />
              Pen Studio
            </button>
            <button
              onClick={() => setActiveTab('paper')}
              className={`flex-1 py-2 text-xs font-bold rounded transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'paper' ? 'bg-neutral-800 text-white shadow' : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Layers size={13} />
              Paper Studio
            </button>
            <button
              onClick={() => setActiveTab('medium')}
              className={`flex-1 py-2 text-xs font-bold rounded transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'medium' ? 'bg-neutral-800 text-white shadow' : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Droplet size={13} />
              Medium Studio
            </button>
          </div>

          <AnimatePresence mode="wait">
            
            {/* PEN STUDIO */}
            {activeTab === 'pen' && (
              <motion.div
                key="pen-studio"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-4 text-xs"
              >
                <div className="bg-neutral-900/60 p-4 rounded-xl border border-neutral-800/80 space-y-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="font-semibold text-neutral-400">Brush/Pen Name</label>
                    <input
                      type="text"
                      value={brushName}
                      onChange={(e) => setBrushName(e.target.value)}
                      className="bg-neutral-800 border border-neutral-700 rounded-lg p-2 text-white outline-none focus:border-white transition-all text-xs"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="font-semibold text-neutral-400">Core Applicator Medium</label>
                    <select
                      value={brushType}
                      onChange={(e) => setBrushType(e.target.value as any)}
                      className="bg-neutral-800 border border-neutral-700 rounded-lg p-2 text-white outline-none cursor-pointer text-xs"
                    >
                      <option value="watercolor">Watercolor Bristles</option>
                      <option value="oil">Heavy Viscose Oils</option>
                      <option value="charcoal">Raw Organic Charcoal</option>
                      <option value="pastel">Velvet Chalk Pastel</option>
                      <option value="graphite">Graphite Lead Core</option>
                      <option value="ink">Precision Felt Tip Ink</option>
                      <option value="marker">Alcohol Saturation Marker</option>
                    </select>
                  </div>
                </div>

                <div className="bg-neutral-900/60 p-4 rounded-xl border border-neutral-800/80 space-y-4">
                  <h3 className="font-bold text-neutral-300 border-b border-neutral-800 pb-2 mb-2 flex items-center justify-between">
                    <span>Applicator Dynamics</span>
                    <Sliders size={13} className="text-neutral-500" />
                  </h3>

                  <div className="space-y-3.5">
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between font-mono text-[10px] text-neutral-400">
                        <span>DEFAULT STAMP SIZE</span>
                        <span>{brushSize}px</span>
                      </div>
                      <input
                        type="range"
                        min="5"
                        max="100"
                        value={brushSize}
                        onChange={(e) => setBrushSize(parseInt(e.target.value))}
                        className="w-full accent-white h-1 bg-neutral-800 rounded-full cursor-pointer"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between font-mono text-[10px] text-neutral-400">
                        <span>FLOW DENSITY / OPACITY</span>
                        <span>{Math.round(brushOpacity * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="1.0"
                        step="0.05"
                        value={brushOpacity}
                        onChange={(e) => setBrushOpacity(parseFloat(e.target.value))}
                        className="w-full accent-white h-1 bg-neutral-800 rounded-full cursor-pointer"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between font-mono text-[10px] text-neutral-400">
                        <span>MEDIUM FLUIDITY / SOLVENT RATIO</span>
                        <span>{Math.round(brushFluidity * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1.0"
                        step="0.05"
                        value={brushFluidity}
                        onChange={(e) => setBrushFluidity(parseFloat(e.target.value))}
                        className="w-full accent-white h-1 bg-neutral-800 rounded-full cursor-pointer"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between font-mono text-[10px] text-neutral-400">
                        <span>PIGMENT LOAD CAPACITY</span>
                        <span>{Math.round(brushPaintLoad * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="1.0"
                        step="0.05"
                        value={brushPaintLoad}
                        onChange={(e) => setBrushPaintLoad(parseFloat(e.target.value))}
                        className="w-full accent-white h-1 bg-neutral-800 rounded-full cursor-pointer"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between font-mono text-[10px] text-neutral-400">
                        <span>STYLUS PRESSURE SENSITIVITY</span>
                        <span>{Math.round(pressureSens * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1.0"
                        step="0.05"
                        value={pressureSens}
                        onChange={(e) => setPressureSens(parseFloat(e.target.value))}
                        className="w-full accent-white h-1 bg-neutral-800 rounded-full cursor-pointer"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between font-mono text-[10px] text-neutral-400">
                        <span>PEN TILT OFFSET DEFLECTION</span>
                        <span>{Math.round(tiltInfluence * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1.0"
                        step="0.05"
                        value={tiltInfluence}
                        onChange={(e) => setTiltInfluence(parseFloat(e.target.value))}
                        className="w-full accent-white h-1 bg-neutral-800 rounded-full cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleSaveBrushClick}
                  className="w-full bg-white hover:bg-neutral-200 text-neutral-900 font-bold py-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-center gap-2 mt-4"
                >
                  <Check size={14} /> Add Custom Brush to Studio
                </button>
              </motion.div>
            )}

            {/* PAPER STUDIO */}
            {activeTab === 'paper' && (
              <motion.div
                key="paper-studio"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-4 text-xs"
              >
                <div className="bg-neutral-900/60 p-4 rounded-xl border border-neutral-800/80 space-y-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="font-semibold text-neutral-400">Canvas Surface Name</label>
                    <input
                      type="text"
                      value={paperName}
                      onChange={(e) => setPaperName(e.target.value)}
                      className="bg-neutral-800 border border-neutral-700 rounded-lg p-2 text-white outline-none focus:border-white transition-all text-xs"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <label className="font-semibold text-neutral-400">Surface Base Tint</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={paperColor}
                        onChange={(e) => setPaperColor(e.target.value)}
                        className="w-8 h-8 rounded border border-neutral-700 bg-transparent cursor-pointer"
                      />
                      <span className="font-mono text-[10px] text-neutral-400">{paperColor.toUpperCase()}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-neutral-900/60 p-4 rounded-xl border border-neutral-800/80 space-y-4">
                  <h3 className="font-bold text-neutral-300 border-b border-neutral-800 pb-2 mb-2">
                    Surface Topography & Texture
                  </h3>

                  <div className="space-y-3.5">
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between font-mono text-[10px] text-neutral-400">
                        <span>ROUGHNESS HEIGHT VARIATION</span>
                        <span>{Math.round(paperRoughness * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="1.0"
                        step="0.05"
                        value={paperRoughness}
                        onChange={(e) => setPaperRoughness(parseFloat(e.target.value))}
                        className="w-full accent-white h-1 bg-neutral-800 rounded-full cursor-pointer"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between font-mono text-[10px] text-neutral-400">
                        <span>FLUID ABSORPTION / DRYING SPEED</span>
                        <span>{Math.round(paperAbsorption * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="1.0"
                        step="0.05"
                        value={paperAbsorption}
                        onChange={(e) => setPaperAbsorption(parseFloat(e.target.value))}
                        className="w-full accent-white h-1 bg-neutral-800 rounded-full cursor-pointer"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between font-mono text-[10px] text-neutral-400">
                        <span>FIBER SEED SCALE (GRAIN DENSITY)</span>
                        <span>{Math.round(fiberScale * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.15"
                        max="0.85"
                        step="0.05"
                        value={fiberScale}
                        onChange={(e) => setFiberScale(parseFloat(e.target.value))}
                        className="w-full accent-white h-1 bg-neutral-800 rounded-full cursor-pointer"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between font-mono text-[10px] text-neutral-400">
                        <span>GRAIN DEPTH relief relief shading</span>
                        <span>{Math.round(grainDepth * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="1.0"
                        step="0.05"
                        value={grainDepth}
                        onChange={(e) => setGrainDepth(parseFloat(e.target.value))}
                        className="w-full accent-white h-1 bg-neutral-800 rounded-full cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleSavePaperClick}
                  className="w-full bg-white hover:bg-neutral-200 text-neutral-900 font-bold py-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-center gap-2 mt-4"
                >
                  <Check size={14} /> Fabricate Custom Paper
                </button>
              </motion.div>
            )}

            {/* MEDIUM STUDIO */}
            {activeTab === 'medium' && (
              <motion.div
                key="medium-studio"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-4 text-xs"
              >
                <div className="bg-neutral-900/60 p-4 rounded-xl border border-neutral-800/80 space-y-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="font-semibold text-neutral-400">Chemical Medium Name</label>
                    <input
                      type="text"
                      value={mediumName}
                      onChange={(e) => setMediumName(e.target.value)}
                      className="bg-neutral-800 border border-neutral-700 rounded-lg p-2 text-white outline-none focus:border-white transition-all text-xs"
                    />
                  </div>
                </div>

                <div className="bg-neutral-900/60 p-4 rounded-xl border border-neutral-800/80 space-y-4">
                  <h3 className="font-bold text-neutral-300 border-b border-neutral-800 pb-2 mb-2">
                    Chemical Composition
                  </h3>

                  <div className="space-y-3.5">
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between font-mono text-[10px] text-neutral-400">
                        <span>VISCOSITY (THICKNESS / SHEAR THINNING)</span>
                        <span>{Math.round(viscosity * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="1.0"
                        step="0.05"
                        value={viscosity}
                        onChange={(e) => setViscosity(parseFloat(e.target.value))}
                        className="w-full accent-white h-1 bg-neutral-800 rounded-full cursor-pointer"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between font-mono text-[10px] text-neutral-400">
                        <span>SOLVENT EVAPORATION / DRYING DELAY</span>
                        <span>{Math.round(dryingRate * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="1.0"
                        step="0.05"
                        value={dryingRate}
                        onChange={(e) => setDryingRate(parseFloat(e.target.value))}
                        className="w-full accent-white h-1 bg-neutral-800 rounded-full cursor-pointer"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between font-mono text-[10px] text-neutral-400">
                        <span>PIGMENT GRANULARITY (SETTLING GRAVITY)</span>
                        <span>{Math.round(granularity * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="1.0"
                        step="0.05"
                        value={granularity}
                        onChange={(e) => setGranularity(parseFloat(e.target.value))}
                        className="w-full accent-white h-1 bg-neutral-800 rounded-full cursor-pointer"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between font-mono text-[10px] text-neutral-400">
                        <span>BINDER-TO-SOLVENT ratio (GLOSS & STICKINESS)</span>
                        <span>{Math.round(binderRatio * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="1.0"
                        step="0.05"
                        value={binderRatio}
                        onChange={(e) => setBinderRatio(parseFloat(e.target.value))}
                        className="w-full accent-white h-1 bg-neutral-800 rounded-full cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleSaveMediumClick}
                  className="w-full bg-white hover:bg-neutral-200 text-neutral-900 font-bold py-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-center gap-2 mt-4"
                >
                  <Check size={14} /> Synthesize Chemical Medium
                </button>
              </motion.div>
            )}

          </AnimatePresence>

        </div>

        {/* Right Side: Scratchpad and 3D preview */}
        <div className="flex-1 bg-neutral-950 flex flex-col items-center justify-center p-8 overflow-y-auto">
          
          <div className="max-w-[360px] w-full space-y-4">
            
            {/* Live Interactive Scratchpad */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col">
              
              <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wide text-neutral-400 font-mono">
                  Interactive Lab Scratchpad
                </span>
                <button
                  onClick={handleClearScratch}
                  className="text-[10px] text-neutral-500 hover:text-white flex items-center gap-1 cursor-pointer font-mono"
                >
                  <Undo size={11} /> Reset Pad
                </button>
              </div>

              {/* The Scratchpad Canvas */}
              <div className="w-80 h-80 relative bg-white self-center">
                <canvas
                  ref={scratchCanvasRef}
                  onPointerDown={handleScratchPointerDown}
                  onPointerMove={handleScratchPointerMove}
                  onPointerUp={handleScratchPointerUp}
                  onPointerLeave={handleScratchPointerUp}
                  onPointerCancel={handleScratchPointerUp}
                  className="w-full h-full cursor-crosshair touch-none"
                />
              </div>

              <div className="p-3 text-center text-[10px] text-neutral-500 italic leading-relaxed border-t border-neutral-800/50">
                Scribble on the scratchpad using your cursor/stylus to test physical blending and texture responses in real-time.
              </div>
            </div>

            {/* List of Custom Crafted items already in studio */}
            <div className="bg-neutral-900/60 border border-neutral-800/60 rounded-xl p-4 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                Studio Lab Inventory
              </h3>

              <div className="space-y-1.5 text-[11px] max-h-[140px] overflow-y-auto no-scrollbar">
                {activeTab === 'pen' && (
                  customBrushes.length === 0 ? (
                    <div className="text-neutral-600 text-center py-2">No custom pens crafted yet.</div>
                  ) : (
                    customBrushes.map((b) => (
                      <div key={b.id} className="flex justify-between items-center bg-neutral-800/40 px-2.5 py-1.5 rounded-lg border border-neutral-800">
                        <span className="font-semibold text-neutral-300">{b.name}</span>
                        <span className="text-[9px] uppercase bg-neutral-700/60 text-neutral-400 px-1.5 py-0.5 rounded font-mono">
                          {b.settings.type}
                        </span>
                      </div>
                    ))
                  )
                )}

                {activeTab === 'paper' && (
                  customPapers.length === 0 ? (
                    <div className="text-neutral-600 text-center py-2">No custom surfaces fabricated yet.</div>
                  ) : (
                    customPapers.map((p) => (
                      <div key={p.id} className="flex justify-between items-center bg-neutral-800/40 px-2.5 py-1.5 rounded-lg border border-neutral-800">
                        <span className="font-semibold text-neutral-300">{p.name}</span>
                        <span className="text-[9px] font-mono text-neutral-500" style={{ color: p.settings.color }}>
                          {p.settings.color.toUpperCase()}
                        </span>
                      </div>
                    ))
                  )
                )}

                {activeTab === 'medium' && (
                  customMediums.length === 0 ? (
                    <div className="text-neutral-600 text-center py-2">No chemical mixtures synthesized yet.</div>
                  ) : (
                    customMediums.map((m) => (
                      <div key={m.id} className="flex justify-between items-center bg-neutral-800/40 px-2.5 py-1.5 rounded-lg border border-neutral-800">
                        <span className="font-semibold text-neutral-300">{m.name}</span>
                        <span className="text-[9px] text-neutral-400 font-mono">Visc: {Math.round(m.viscosity * 100)}%</span>
                      </div>
                    ))
                  )
                )}
              </div>
            </div>

          </div>

        </div>

      </div>

    </div>
  );
}
