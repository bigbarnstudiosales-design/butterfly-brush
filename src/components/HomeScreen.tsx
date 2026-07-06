import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, Layers, Eye, Folder, Palette, Settings, Sparkles, 
  Trash2, Copy, FileCode, Beaker, Check, Sliders
} from 'lucide-react';
import { Artwork, PaperSettings, PaperType } from '../types';

interface HomeScreenProps {
  artworks: Artwork[];
  onCreateArtwork: (name: string, width: number, height: number, paperType: PaperType) => void;
  onSelectArtwork: (id: string) => void;
  onDeleteArtwork: (id: string) => void;
  onCloneArtwork: (id: string) => void;
  onEnterStudio: () => void;
}

export default function HomeScreen({
  artworks,
  onCreateArtwork,
  onSelectArtwork,
  onDeleteArtwork,
  onCloneArtwork,
  onEnterStudio,
}: HomeScreenProps) {
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [newArtName, setNewArtName] = useState<string>('Untitled Physical Canvas');
  const [newArtWidth, setNewArtWidth] = useState<number>(800);
  const [newArtHeight, setNewArtHeight] = useState<number>(800);
  const [initialPaper, setInitialPaper] = useState<PaperType>('rough_watercolor');

  const handleSubmitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newArtName.trim()) return;

    onCreateArtwork(newArtName, newArtWidth, newArtHeight, initialPaper);
    setShowCreateModal(false);
    // Reset defaults
    setNewArtName('Untitled Physical Canvas');
    setNewArtWidth(800);
    setNewArtHeight(800);
  };

  return (
    <div className="min-h-screen w-screen bg-neutral-950 text-white overflow-y-auto font-sans flex flex-col">
      
      {/* Decorative Branding header & Navigation Hero */}
      <section className="relative overflow-hidden py-16 px-8 md:px-16 border-b border-neutral-900 bg-neutral-900/10">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-12 w-80 h-80 bg-blue-500/5 rounded-full blur-[100px] pointer-events-none" />

        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-neutral-900 border border-neutral-800 text-[10px] font-semibold text-neutral-400 tracking-wider uppercase">
              <Sparkles size={11} className="text-emerald-400 animate-pulse" />
              Kubelka-Munk & Navier-Stokes Solver
            </div>
            <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-neutral-100 font-sans">
              Natural Media Art Studio
            </h1>
            <p className="text-neutral-500 text-sm md:text-base max-w-xl font-light leading-relaxed">
              Experience truly physical painting simulation on customized papers. Interact with fluid dynamics and real pigment absorption layers directly on your desktop or tablet.
            </p>
          </div>

          <div className="flex gap-3">
            {/* Custom Studio Lab Button */}
            <button
              onClick={onEnterStudio}
              className="px-5 py-3 rounded-xl border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 hover:border-neutral-700 transition-all font-bold text-xs cursor-pointer flex items-center gap-2"
            >
              <Beaker size={14} className="text-blue-400" />
              <span>Studio Craft Labs</span>
            </button>

            {/* Create New Canvas trigger */}
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-5 py-3 rounded-xl bg-white text-neutral-950 hover:bg-neutral-200 transition-all font-extrabold text-xs cursor-pointer flex items-center gap-2 shadow-lg shadow-white/5"
            >
              <Plus size={14} />
              <span>New Canvas</span>
            </button>
          </div>
        </div>
      </section>

      {/* Primary Project Management workspace */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-8 md:p-16 space-y-12">
        
        {/* Project List / Grid */}
        <section className="space-y-6">
          <div className="flex items-center justify-between border-b border-neutral-900 pb-4">
            <h2 className="text-lg font-bold tracking-wide flex items-center gap-2">
              <Folder size={16} className="text-neutral-400" />
              Your Natural Media Projects
            </h2>
            <span className="text-xs font-mono text-neutral-500">{artworks.length} CANVASES</span>
          </div>

          {artworks.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-20 bg-neutral-900/20 border border-neutral-900 rounded-3xl space-y-4">
              <div className="w-12 h-12 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-500">
                <Palette size={20} />
              </div>
              <div>
                <h3 className="font-bold text-sm text-neutral-300">Your gallery is currently empty</h3>
                <p className="text-[11px] text-neutral-600 mt-1">Create your first physical canvas to start painting!</p>
              </div>
              <button
                onClick={() => setShowCreateModal(true)}
                className="bg-neutral-800 text-neutral-200 border border-neutral-700 hover:bg-neutral-700 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all"
              >
                Create Artwork
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {artworks.map((art) => (
                <div
                  key={art.id}
                  className="group bg-neutral-900/40 border border-neutral-900 hover:border-neutral-800 rounded-2xl overflow-hidden transition-all duration-300 flex flex-col justify-between"
                >
                  {/* Aspect Square Canvas preview box */}
                  <div 
                    onClick={() => onSelectArtwork(art.id)}
                    className="aspect-square bg-neutral-900 relative cursor-pointer overflow-hidden border-b border-neutral-950 flex items-center justify-center"
                  >
                    {art.previewUrl ? (
                      <img 
                        src={art.previewUrl} 
                        alt={art.name} 
                        className="w-full h-full object-contain group-hover:scale-102 transition-transform duration-500"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      // Checkerboard placeholder for empty drawing
                      <div 
                        className="absolute inset-0 opacity-15"
                        style={{
                          backgroundImage: 'radial-gradient(#ffffff 1px, transparent 0), radial-gradient(#ffffff 1px, transparent 0)',
                          backgroundSize: '16px 16px',
                          backgroundPosition: '0 0, 8px 8px',
                          backgroundColor: art.paperSettings.color,
                        }}
                      />
                    )}

                    {/* Paper grain/type label */}
                    <div className="absolute bottom-3 left-3 bg-neutral-950/85 backdrop-blur px-2.5 py-1 rounded-full text-[9px] uppercase tracking-wider text-neutral-400 font-semibold border border-neutral-800/80">
                      {art.paperSettings.name}
                    </div>
                  </div>

                  {/* Project Details Footer */}
                  <div className="p-4 space-y-3 bg-neutral-900/20">
                    <div 
                      onClick={() => onSelectArtwork(art.id)}
                      className="cursor-pointer space-y-0.5"
                    >
                      <h3 className="font-bold text-sm tracking-wide text-neutral-200 truncate group-hover:text-white transition-colors">
                        {art.name}
                      </h3>
                      <div className="flex items-center gap-1.5 text-[10px] font-mono text-neutral-500">
                        <span>{art.width}x{art.height} px</span>
                        <span>•</span>
                        <span>{art.layers.length} {art.layers.length === 1 ? 'Layer' : 'Layers'}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-neutral-900/60 pt-3">
                      <span className="text-[9px] text-neutral-600 font-mono uppercase">
                        Edited {new Date(art.updatedAt).toLocaleDateString()}
                      </span>

                      {/* Control operations */}
                      <div className="flex items-center gap-1.5 opacity-60 hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => onCloneArtwork(art.id)}
                          className="p-1.5 rounded-md hover:bg-neutral-800 text-neutral-400 hover:text-white cursor-pointer transition-colors"
                          title="Clone Canvas"
                        >
                          <Copy size={12} />
                        </button>
                        <button
                          onClick={() => onDeleteArtwork(art.id)}
                          className="p-1.5 rounded-md hover:bg-neutral-800 text-neutral-400 hover:text-red-400 cursor-pointer transition-colors"
                          title="Delete Canvas"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

      </main>

      {/* Creation Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 w-full max-w-[420px] text-white space-y-5 shadow-2xl relative"
            >
              <h3 className="text-base font-bold tracking-wide">
                Configure Physical Painting Canvas
              </h3>

              <form onSubmit={handleSubmitCreate} className="space-y-4 text-xs">
                
                <div className="flex flex-col gap-1.5">
                  <label className="font-semibold text-neutral-400">Artwork Project Name</label>
                  <input
                    type="text"
                    value={newArtName}
                    onChange={(e) => setNewArtName(e.target.value)}
                    className="bg-neutral-800 border border-neutral-700 rounded-xl p-2.5 text-white outline-none focus:border-white transition-all"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="font-semibold text-neutral-400">Width (pixels)</label>
                    <input
                      type="number"
                      min="200"
                      max="2000"
                      value={newArtWidth}
                      onChange={(e) => setNewArtWidth(parseInt(e.target.value))}
                      className="bg-neutral-800 border border-neutral-700 rounded-xl p-2.5 text-white outline-none focus:border-white transition-all font-mono"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="font-semibold text-neutral-400">Height (pixels)</label>
                    <input
                      type="number"
                      min="200"
                      max="2000"
                      value={newArtHeight}
                      onChange={(e) => setNewArtHeight(parseInt(e.target.value))}
                      className="bg-neutral-800 border border-neutral-700 rounded-xl p-2.5 text-white outline-none focus:border-white transition-all font-mono"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="font-semibold text-neutral-400">Starting Canvas Paper Style</label>
                  <select
                    value={initialPaper}
                    onChange={(e) => setInitialPaper(e.target.value as any)}
                    className="bg-neutral-800 border border-neutral-700 rounded-xl p-2.5 text-white outline-none cursor-pointer"
                  >
                    <option value="rough_watercolor">Rough Watercolor Paper (Saturated spread)</option>
                    <option value="smooth_hotpress">Smooth Hotpress Paper (Fine bleed details)</option>
                    <option value="canvas_linen">Heavy Linen Canvas (Perfect for thick Oil paint)</option>
                    <option value="smooth_layout">Layout Board (Dry media and markers)</option>
                  </select>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="flex-1 py-2.5 rounded-xl border border-neutral-700 text-neutral-300 hover:bg-neutral-800 transition-all font-semibold cursor-pointer text-center"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl bg-white text-neutral-950 hover:bg-neutral-200 transition-all font-bold cursor-pointer text-center"
                  >
                    Create Canvas
                  </button>
                </div>

              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
