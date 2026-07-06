import React from 'react';
import { X, Plus, Eye, EyeOff, Layers as LayersIcon, Trash2 } from 'lucide-react';
import { Layer } from '../types';

interface LayersPanelProps {
  layers: Layer[];
  activeLayerId: string;
  setActiveLayerId: (id: string) => void;
  onAddLayer: () => void;
  onDeleteLayer: (id: string) => void;
  onToggleLayerVisibility: (id: string) => void;
  onLayerOpacityChange: (id: string, opacity: number) => void;
  onClose: () => void;
}

export default function LayersPanel({
  layers, activeLayerId, setActiveLayerId, onAddLayer, onDeleteLayer,
  onToggleLayerVisibility, onLayerOpacityChange, onClose,
}: LayersPanelProps) {
  const active = layers.find((l) => l.id === activeLayerId);

  return (
    <div className="w-[280px] bg-neutral-900/95 backdrop-blur-md border border-neutral-800 rounded-2xl shadow-2xl text-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800">
        <span className="text-xs font-semibold tracking-wide">Layers</span>
        <div className="flex items-center gap-1">
          <button
            onClick={onAddLayer}
            className="flex items-center gap-1 bg-white hover:bg-neutral-200 text-neutral-900 px-2 py-0.5 rounded-full text-[10.5px] font-bold transition-all"
          >
            <Plus size={11} /> Add
          </button>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="p-3 flex flex-col gap-2">
        {/* Layer stack (top layer first) */}
        <div className="overflow-y-auto space-y-1 pr-1 max-h-[240px] no-scrollbar flex flex-col-reverse">
          {layers.map((layer) => {
            const isActive = layer.id === activeLayerId;
            return (
              <div
                key={layer.id}
                className={`flex items-center justify-between p-2 rounded-lg border text-[11px] transition-all ${
                  isActive ? 'bg-white/10 border-white/50 text-white' : 'bg-neutral-800/40 border-neutral-700/40 text-neutral-300 hover:bg-neutral-800/80'
                }`}
              >
                <div className="flex items-center gap-1.5 cursor-pointer flex-1 truncate" onClick={() => setActiveLayerId(layer.id)}>
                  <LayersIcon size={12} className={isActive ? 'text-white' : 'text-neutral-500'} />
                  <span className="truncate">{layer.name}</span>
                </div>
                <div className="flex items-center gap-1.5 pl-2">
                  <button onClick={() => onToggleLayerVisibility(layer.id)} className="text-neutral-400 hover:text-white transition-colors">
                    {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>
                  {layers.length > 1 && (
                    <button onClick={() => onDeleteLayer(layer.id)} className="text-neutral-400 hover:text-red-400 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Active layer opacity */}
        {active && (
          <div className="bg-neutral-800/50 p-2.5 rounded-lg border border-neutral-700/30">
            <div className="flex justify-between text-neutral-400 font-mono text-[10px] mb-1">
              <span>LAYER OPACITY</span>
              <span>{Math.round((active.opacity || 0) * 100)}%</span>
            </div>
            <input
              type="range" min="0" max="1" step="0.05" value={active.opacity || 0}
              onChange={(e) => onLayerOpacityChange(activeLayerId, parseFloat(e.target.value))}
              className="w-full accent-white h-1 rounded-full cursor-pointer bg-neutral-700"
            />
          </div>
        )}
      </div>
    </div>
  );
}
