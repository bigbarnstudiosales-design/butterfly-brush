import React, { useState } from 'react';
import { X, Search, Droplet, Paintbrush, Sparkles, Sliders } from 'lucide-react';
import { BrushSettings, BrushType } from '../types';

interface BrushPanelProps {
  brushSettings: BrushSettings;
  setBrushSettings: (settings: BrushSettings) => void;
  onClose: () => void;
}

interface LibraryBrush {
  id: string;
  name: string;
  category: 'wet' | 'dry' | 'precision';
  type: BrushType;
  size: number;
  opacity: number;
  fluidity: number;
  paintLoad: number;
  description: string;
}

const BRUSH_LIBRARY: LibraryBrush[] = [
  { id: 'lib-1', name: 'Fluid Wash Watercolor', category: 'wet', type: 'watercolor', size: 90, opacity: 0.45, fluidity: 0.9, paintLoad: 0.6, description: 'Broad, wet washes that bleed gracefully' },
  { id: 'lib-2', name: 'Detail Sable Watercolor', category: 'wet', type: 'watercolor', size: 12, opacity: 0.85, fluidity: 0.7, paintLoad: 0.4, description: 'Fine watercolor detail with sharp points' },
  { id: 'lib-3', name: 'Sponge Dappler', category: 'wet', type: 'watercolor', size: 65, opacity: 0.6, fluidity: 0.8, paintLoad: 0.75, description: 'Textured dabbing with medium absorption' },
  { id: 'lib-4', name: 'Hog Bristle Oil', category: 'wet', type: 'oil', size: 35, opacity: 0.9, fluidity: 0.3, paintLoad: 0.7, description: 'Coarse hair brush leaving rich oil grooves' },
  { id: 'lib-5', name: 'Impasto Palette Knife', category: 'wet', type: 'oil', size: 70, opacity: 1.0, fluidity: 0.15, paintLoad: 0.95, description: 'Thick, unblended paint laid down with metal' },
  { id: 'lib-6', name: 'Glazing Fan Oil', category: 'wet', type: 'oil', size: 50, opacity: 0.35, fluidity: 0.6, paintLoad: 0.5, description: 'Thin, semi-transparent layers of glossy oil' },
  { id: 'lib-7', name: 'Alcohol Felt Marker', category: 'wet', type: 'marker', size: 28, opacity: 0.65, fluidity: 0.5, paintLoad: 0.6, description: 'Broad chisel marker with smooth overlap' },
  { id: 'lib-8', name: 'Fine Point Pen', category: 'precision', type: 'ink', size: 3, opacity: 1.0, fluidity: 0.05, paintLoad: 0.15, description: 'High-contrast precision black technical pen' },
  { id: 'lib-9', name: 'Calligraphy Nib', category: 'precision', type: 'ink', size: 18, opacity: 1.0, fluidity: 0.3, paintLoad: 0.7, description: 'Elegant tapered ink lines for scripting' },
  { id: 'lib-10', name: '2H Hard Pencil', category: 'precision', type: 'graphite', size: 4, opacity: 0.8, fluidity: 0.1, paintLoad: 0.2, description: 'Very light, sharp technical drawing lead' },
  { id: 'lib-11', name: '6B Sketching Lead', category: 'precision', type: 'graphite', size: 14, opacity: 0.9, fluidity: 0.2, paintLoad: 0.4, description: 'Soft graphite lead for dark shading lines' },
  { id: 'lib-12', name: 'Charcoal Shading Block', category: 'dry', type: 'charcoal', size: 85, opacity: 0.65, fluidity: 0.4, paintLoad: 0.55, description: 'Broad flat charcoal stick for dynamic shadows' },
  { id: 'lib-13', name: 'Detail Vine Charcoal', category: 'dry', type: 'charcoal', size: 10, opacity: 0.85, fluidity: 0.2, paintLoad: 0.4, description: 'Thin charcoal twigs for crisp outlining' },
  { id: 'lib-14', name: 'Chalk Pastel Rod', category: 'dry', type: 'pastel', size: 45, opacity: 0.8, fluidity: 0.35, paintLoad: 0.7, description: 'Vibrant powdery pastel stick for rich color' },
  { id: 'lib-15', name: 'Soft Velvet Blender', category: 'dry', type: 'pastel', size: 110, opacity: 0.3, fluidity: 0.6, paintLoad: 0.2, description: 'Smudges and softens existing pastel colors' },
];

const iconFor = (type: BrushType) =>
  type === 'watercolor' || type === 'marker' ? Droplet :
  type === 'oil' || type === 'ink' ? Paintbrush :
  type === 'charcoal' || type === 'pastel' ? Sparkles : Sliders;

export default function BrushPanel({ brushSettings, setBrushSettings, onClose }: BrushPanelProps) {
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'wet' | 'dry' | 'precision'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const updateSetting = (key: keyof BrushSettings, value: number) => {
    setBrushSettings({ ...brushSettings, [key]: value });
  };

  const filtered = BRUSH_LIBRARY.filter((b) => {
    const matchesCat = selectedCategory === 'all' || b.category === selectedCategory;
    const q = searchQuery.toLowerCase();
    const matchesSearch = b.name.toLowerCase().includes(q) || b.description.toLowerCase().includes(q) || b.type.toLowerCase().includes(q);
    return matchesCat && matchesSearch;
  });

  const params: { key: keyof BrushSettings; label: string; min: number; max: number; step: number; pct?: boolean; unit?: string }[] = [
    { key: 'size', label: 'Size', min: 1, max: 150, step: 1, unit: 'px' },
    { key: 'opacity', label: 'Opacity', min: 0.05, max: 1, step: 0.01, pct: true },
    { key: 'fluidity', label: 'Fluidity', min: 0, max: 1, step: 0.01, pct: true },
    { key: 'paintLoad', label: 'Paint Load', min: 0.1, max: 1, step: 0.01, pct: true },
  ];

  return (
    <div className="w-[300px] bg-neutral-900/95 backdrop-blur-md border border-neutral-800 rounded-2xl shadow-2xl text-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800">
        <span className="text-xs font-semibold tracking-wide">Brushes</span>
        <button onClick={onClose} className="p-1 rounded-full hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="p-3 flex flex-col gap-2">
        {/* Search */}
        <div className="relative flex items-center bg-neutral-950/50 rounded-lg px-2 py-1.5 border border-neutral-800 focus-within:border-neutral-700 transition-all">
          <Search size={12} className="text-neutral-500 mr-1.5" />
          <input
            type="text"
            placeholder="Search brushes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent border-none outline-none text-neutral-200 placeholder-neutral-500 w-full text-[11px]"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-neutral-500 hover:text-neutral-300">
              <X size={10} />
            </button>
          )}
        </div>

        {/* Categories */}
        <div className="flex gap-1">
          {(['all', 'wet', 'dry', 'precision'] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`flex-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold border transition-all ${
                selectedCategory === cat ? 'bg-neutral-100 border-white text-neutral-900' : 'bg-neutral-800/40 border-neutral-800 text-neutral-400 hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Library list */}
        <div className="overflow-y-auto space-y-1 pr-1 max-h-[220px] no-scrollbar">
          {filtered.map((brush) => {
            const isSelected = brushSettings.type === brush.type && brushSettings.size === brush.size &&
              brushSettings.opacity === brush.opacity && brushSettings.fluidity === brush.fluidity && brushSettings.paintLoad === brush.paintLoad;
            const Icon = iconFor(brush.type);
            return (
              <button
                key={brush.id}
                onClick={() => setBrushSettings({
                  ...brushSettings, type: brush.type, size: brush.size, opacity: brush.opacity, fluidity: brush.fluidity, paintLoad: brush.paintLoad,
                })}
                className={`w-full flex items-center justify-between p-1.5 rounded-lg border text-left transition-all ${
                  isSelected ? 'bg-white/10 border-white/50 text-white' : 'bg-neutral-800/30 border-neutral-800/40 text-neutral-300 hover:bg-neutral-800/60 hover:border-neutral-700'
                }`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`p-1 rounded ${isSelected ? 'bg-white/10 text-white' : 'bg-neutral-900/60 text-neutral-400'}`}>
                    <Icon size={11} />
                  </span>
                  <div className="truncate">
                    <div className="font-semibold truncate text-[11px]">{brush.name}</div>
                    <div className="text-[9.5px] text-neutral-500 truncate leading-none mt-0.5">{brush.description}</div>
                  </div>
                </div>
                <div className="text-[10px] font-mono text-neutral-400 pl-1">{brush.size}px</div>
              </button>
            );
          })}
        </div>

        {/* Parameters */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 bg-neutral-800/30 p-2.5 rounded-lg border border-neutral-700/20">
          {params.map((p) => {
            const val = brushSettings[p.key] as number;
            return (
              <div key={p.key} className="flex flex-col">
                <span className="text-neutral-400 flex justify-between font-mono text-[10px]">
                  <span>{p.label.toUpperCase()}</span>
                  <span>{p.pct ? `${Math.round(val * 100)}%` : `${val}${p.unit || ''}`}</span>
                </span>
                <input
                  type="range" min={p.min} max={p.max} step={p.step} value={val}
                  onChange={(e) => updateSetting(p.key, p.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value))}
                  className="w-full accent-white h-0.5 rounded-full cursor-pointer bg-neutral-700"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
