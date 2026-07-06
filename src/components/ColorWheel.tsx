import React, { useRef, useEffect, useState, useCallback } from 'react';

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return [r, g, b];
}

interface ColorWheelProps {
  hex: string;
  size?: number;
  onChange: (hex: string) => void;
  onCommit?: (hex: string) => void;
}

/**
 * Circular hue/saturation picker (angle = hue, radius = saturation) with a
 * brightness slider underneath. A round wheel is the natural fit for a
 * radial menu — much more legible and immediate than abstract sliders.
 */
export default function ColorWheel({ hex, size = 140, onChange, onCommit }: ColorWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);
  const [hsv, setHsv] = useState<[number, number, number]>(() => rgbToHsv(...hexToRgb(hex)));

  // Keep in sync when the color changes from outside (preset click, hex input),
  // but not while the user is actively dragging the wheel themselves.
  useEffect(() => {
    if (draggingRef.current) return;
    setHsv(rgbToHsv(...hexToRgb(hex)));
  }, [hex]);

  // Repaint the wheel only when brightness changes — hue/saturation drags
  // just move the marker, no need to regenerate 20k pixels per frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = w / 2;
    const img = ctx.createImageData(w, h);
    const v = hsv[2];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx + 0.5;
        const dy = y - cy + 0.5;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const idx = (y * w + x) * 4;
        if (dist > radius) {
          img.data[idx + 3] = 0;
          continue;
        }
        let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (angle < 0) angle += 360;
        const s = Math.min(1, dist / radius);
        const [r, g, b] = hsvToRgb(angle, s, v);
        img.data[idx] = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = b;
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hsv[2], size]);

  const updateFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const radius = rect.width / 2;
      const dist = Math.min(radius, Math.sqrt(dx * dx + dy * dy));
      let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (angle < 0) angle += 360;
      const s = radius > 0 ? dist / radius : 0;
      const nextHsv: [number, number, number] = [angle, s, hsv[2]];
      setHsv(nextHsv);
      const [r, g, b] = hsvToRgb(nextHsv[0], nextHsv[1], nextHsv[2]);
      onChange(rgbToHex(r, g, b));
    },
    [hsv, onChange]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromPointer(e.clientX, e.clientY);
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return;
    updateFromPointer(e.clientX, e.clientY);
  };
  const commitCurrent = () => {
    const [r, g, b] = hsvToRgb(hsv[0], hsv[1], hsv[2]);
    onCommit?.(rgbToHex(r, g, b));
  };
  const handlePointerUp = () => {
    if (draggingRef.current) commitCurrent();
    draggingRef.current = false;
  };

  const handleValueChange = (v: number) => {
    const nextHsv: [number, number, number] = [hsv[0], hsv[1], v];
    setHsv(nextHsv);
    const [r, g, b] = hsvToRgb(nextHsv[0], nextHsv[1], nextHsv[2]);
    onChange(rgbToHex(r, g, b));
  };

  const [h, s] = hsv;
  const markerRadius = s * (size / 2);
  const markerAngleRad = (h * Math.PI) / 180;
  const markerX = size / 2 + Math.cos(markerAngleRad) * markerRadius;
  const markerY = size / 2 + Math.sin(markerAngleRad) * markerRadius;

  return (
    <div className="flex flex-col items-center gap-2.5 w-full">
      <div className="relative" style={{ width: size, height: size }}>
        <canvas
          ref={canvasRef}
          width={size}
          height={size}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className="rounded-full cursor-crosshair touch-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
        />
        <div
          className="absolute w-4 h-4 rounded-full border-2 border-white pointer-events-none -translate-x-1/2 -translate-y-1/2"
          style={{ left: markerX, top: markerY, backgroundColor: hex, boxShadow: '0 0 0 1px rgba(0,0,0,0.5), 0 1px 4px rgba(0,0,0,0.6)' }}
        />
      </div>
      <div className="w-full flex items-center gap-2 px-1">
        <span className="text-[10px] text-neutral-500 font-mono">DARK</span>
        <input
          type="range"
          min="0.03"
          max="1"
          step="0.01"
          value={hsv[2]}
          onChange={(e) => handleValueChange(parseFloat(e.target.value))}
          onPointerUp={commitCurrent}
          className="flex-1 accent-white h-1 rounded-full cursor-pointer bg-neutral-700"
        />
        <span className="text-[10px] text-neutral-500 font-mono">LIGHT</span>
      </div>
    </div>
  );
}
