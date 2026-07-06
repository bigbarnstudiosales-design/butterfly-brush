import React, { useState, useEffect } from 'react';
import { X, FlaskConical, ChevronDown } from 'lucide-react';
import { BrushSettings, PigmentMix } from '../types';
import {
  BASE_PIGMENTS, pigmentMixToHex, hexToPigmentMix, pigmentMixToStaining, DEFAULT_STAINING,
} from '../utils/kubelkaMunk';
import ColorWheel from './ColorWheel';

interface ColorPanelProps {
  brushSettings: BrushSettings;
  setBrushSettings: (settings: BrushSettings) => void;
  onClose: () => void;
}

const RECENT_KEY = 'natural_media_studio_recent_colors_v1';

export default function ColorPanel({ brushSettings, setBrushSettings, onClose }: ColorPanelProps) {
  const [activePigmentMix, setActivePigmentMix] = useState<PigmentMix>(
    brushSettings.pigmentMix || {
      cadmiumRed: 0.2, ultramarineBlue: 0.2, lemonYellow: 0.2, titaniumWhite: 0.4, lampBlack: 0.0,
    }
  );
  const [hexInput, setHexInput] = useState(brushSettings.color || '#e32636');
  const [showPigmentMix, setShowPigmentMix] = useState(false);
  const [recentColors, setRecentColors] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(RECENT_KEY);
      if (stored) return JSON.parse(stored);
    } catch (e) {}
    return ['#e32636', '#1a3fa0', '#f4c430', '#2e2e2e', '#ffffff', '#8b5a2b', '#3a7d44', '#c96a9c'];
  });

  useEffect(() => {
    setHexInput(brushSettings.color || '#e32636');
  }, [brushSettings.color]);

  useEffect(() => {
    if (brushSettings.pigmentMix) setActivePigmentMix(brushSettings.pigmentMix);
  }, [brushSettings.pigmentMix]);

  const pushRecentColor = (hex: string) => {
    setRecentColors((prev) => {
      const next = [hex, ...prev.filter((c) => c.toLowerCase() !== hex.toLowerCase())].slice(0, 8);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch (e) {}
      return next;
    });
  };

  // Any color picked also gets projected into an approximate Kubelka-Munk mix
  // and adopts that pigment's natural staining behaviour (overridable below).
  const applyColor = (hex: string) => {
    const mix = hexToPigmentMix(hex);
    setActivePigmentMix(mix);
    setBrushSettings({ ...brushSettings, color: hex, pigmentMix: mix, staining: pigmentMixToStaining(mix) });
  };

  const commitHexInput = () => {
    let v = hexInput.trim();
    if (!v.startsWith('#')) v = '#' + v;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      applyColor(v);
      pushRecentColor(v);
    } else {
      setHexInput(brushSettings.color || '#e32636');
    }
  };

  const handlePigmentChange = (pigment: keyof PigmentMix, value: number) => {
    const updatedMix = { ...activePigmentMix, [pigment]: parseFloat(value.toFixed(2)) };
    setActivePigmentMix(updatedMix);
    setBrushSettings({
      ...brushSettings,
      color: pigmentMixToHex(updatedMix),
      pigmentMix: updatedMix,
      staining: pigmentMixToStaining(updatedMix),
    });
  };

  const staining = brushSettings.staining ?? DEFAULT_STAINING;
  const behaviourLabel = staining < 0.4 ? 'Granulating' : staining > 0.65 ? 'Staining' : 'Semi-staining';

  return (
    <div className="w-[280px] bg-neutral-900/95 backdrop-blur-md border border-neutral-800 rounded-2xl shadow-2xl text-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800">
        <span className="text-xs font-semibold tracking-wide">Color</span>
        <button onClick={onClose} className="p-1 rounded-full hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="p-4 flex flex-col items-center gap-3 max-h-[70vh] overflow-y-auto no-scrollbar">
        <ColorWheel hex={brushSettings.color || '#e32636'} size={168} onChange={applyColor} onCommit={pushRecentColor} />

        {/* Swatch + hex entry */}
        <div className="flex items-center gap-2 w-full">
          <div className="w-9 h-9 rounded-lg border border-neutral-700 shrink-0" style={{ backgroundColor: brushSettings.color || '#e32636' }} />
          <input
            type="text"
            value={hexInput}
            onChange={(e) => setHexInput(e.target.value)}
            onBlur={commitHexInput}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            spellCheck={false}
            className="flex-1 min-w-0 bg-neutral-950/60 border border-neutral-800 rounded-lg px-2.5 py-2 text-xs font-mono text-neutral-200 outline-none focus:border-neutral-500 transition-colors"
          />
        </div>

        {/* Recent colors */}
        <div className="flex gap-1.5 flex-wrap justify-center w-full">
          {recentColors.map((c, idx) => (
            <button
              key={idx}
              title={c}
              onClick={() => applyColor(c)}
              className={`rounded-full border cursor-pointer hover:scale-110 transition-all ${
                (brushSettings.color || '').toLowerCase() === c.toLowerCase() ? 'border-white scale-110' : 'border-neutral-600'
              }`}
              style={{ backgroundColor: c, width: 24, height: 24 }}
            />
          ))}
        </div>

        {/* Pigment behaviour: staining <-> granulating */}
        <div className="w-full">
          <div className="flex justify-between items-center text-[10px] mb-1">
            <span className="uppercase tracking-wide font-semibold text-neutral-400">Pigment Behaviour</span>
            <span className="font-mono text-neutral-400">{behaviourLabel}</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={staining}
            onChange={(e) => setBrushSettings({ ...brushSettings, staining: parseFloat(e.target.value) })}
            className="w-full accent-neutral-200 h-1 rounded-full bg-neutral-800 cursor-pointer"
          />
          <div className="flex justify-between text-[8px] text-neutral-600 font-mono mt-0.5">
            <span>GRANULATES · DRIES LIGHT</span>
            <span>STAINS · DRIES RICH</span>
          </div>
        </div>

        {/* Advanced: physical Kubelka-Munk pigment mixing */}
        <button
          onClick={() => setShowPigmentMix((v) => !v)}
          className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide font-semibold text-neutral-500 hover:text-neutral-300 transition-colors self-start"
        >
          <FlaskConical size={11} />
          Physical Pigment Mix
          <ChevronDown size={11} className={`transition-transform ${showPigmentMix ? 'rotate-180' : ''}`} />
        </button>

        {showPigmentMix && (
          <div className="w-full space-y-1.5 bg-neutral-800/30 p-2.5 rounded-lg border border-neutral-700/20">
            {Object.entries(BASE_PIGMENTS).map(([key, pigment]) => {
              const mixKey = key as keyof PigmentMix;
              const value = activePigmentMix[mixKey] || 0;
              return (
                <div key={key} className="flex items-center justify-between gap-2.5 text-[10px]">
                  <span className="w-24 text-left font-semibold truncate text-neutral-300" title={pigment.description}>
                    {pigment.name}
                  </span>
                  <input
                    type="range" min="0" max="1" step="0.05" value={value}
                    onChange={(e) => handlePigmentChange(mixKey, parseFloat(e.target.value))}
                    className="flex-1 accent-neutral-200 h-1 rounded-full bg-neutral-800"
                  />
                  <span className="w-8 text-right font-mono text-neutral-400">{Math.round(value * 100)}%</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
