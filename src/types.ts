export type BrushType = 'watercolor' | 'oil' | 'charcoal' | 'graphite' | 'pastel' | 'ink' | 'marker';

export interface BrushSettings {
  type: BrushType;
  size: number;          // 1 to 150px
  opacity: number;       // 0 to 1 (alpha/density)
  fluidity: number;      // 0 to 1 (watercolor wetness / oil medium blending)
  paintLoad: number;     // 0 to 1 (how much pigment is loaded on brush, depletes with stroke)
  grainInfluence: number;// 0 to 1 (how much paper grain affects texture)
  pressureSensitivity: number; // 0 to 1 (size/opacity curve)
  tiltInfluence: number; // 0 to 1 (brush angle/smear)
  color: string;         // Hex color or pigment concentrations representation
  pigmentMix?: PigmentMix; // For Kubelka-Munk blending
  staining?: number;     // 0 to 1 — watercolor pigment behaviour: 0 = granulating
                         // (settles into paper grain, lifts off as it dries, dries
                         // lighter), 1 = staining (bonds to fibres, dries rich/flat).
                         // Defaults to each pigment's natural value when a color is picked.
}

export interface PigmentMix {
  cadmiumRed: number;     // 0 to 1
  ultramarineBlue: number; // 0 to 1
  lemonYellow: number;    // 0 to 1
  titaniumWhite: number;  // 0 to 1
  lampBlack: number;      // 0 to 1
}

export type PaperType = 'rough_watercolor' | 'smooth_hotpress' | 'canvas_linen' | 'sketchbook_grain' | 'smooth_layout';

export interface PaperSettings {
  id: string;
  name: string;
  type: PaperType;
  roughness: number;      // 0 to 1 (height variation)
  absorption: number;     // 0 to 1 (fluid spread constraint)
  fiberScale: number;     // 0 to 1 (granularity scale)
  grainDepth: number;     // 0 to 1 (shadow relief depth)
  color: string;          // hex background color
}

export interface CustomBrush {
  id: string;
  name: string;
  settings: BrushSettings;
  isCustom: boolean;
}

export interface CustomPaper {
  id: string;
  name: string;
  settings: PaperSettings;
  isCustom: boolean;
}

export interface CustomMedium {
  id: string;
  name: string;
  viscosity: number;       // 0 to 1
  dryingRate: number;      // 0 to 1
  granularity: number;     // 0 to 1 (pigment settling)
  binderRatio: number;     // 0 to 1 (shine and binding)
  isCustom: boolean;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;         // 0 to 1
  blendMode: 'normal' | 'multiply' | 'screen' | 'overlay';
  // ImageData or Canvas references will be managed at runtime in the canvas engine,
  // but metadata is stored here.
}

export interface Artwork {
  id: string;
  name: string;
  width: number;
  height: number;
  layers: Layer[];
  activeLayerId: string;
  paperSettings: PaperSettings;
  previewUrl?: string;     // Base64 thumbnail for gallery
  createdAt: number;
  updatedAt: number;
}
