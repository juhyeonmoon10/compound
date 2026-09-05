import type { TrackPresetId } from "./strategy";
import { publicAsset } from "./public-assets.ts";

export interface CircuitLayoutAsset {
  readonly layoutId: string;
  readonly fileName: string;
}

/**
 * Current layouts for the original 2026 calendar venues. Bahrain and Jeddah
 * use their latest raced layouts because their 2026 events were called off.
 */
export const CIRCUIT_LAYOUTS: Readonly<
  Record<TrackPresetId, CircuitLayoutAsset>
> = {
  melbourne: { layoutId: "melbourne-2", fileName: "melbourne-2.svg" },
  shanghai: { layoutId: "shanghai-1", fileName: "shanghai-1.svg" },
  suzuka: { layoutId: "suzuka-2", fileName: "suzuka-2.svg" },
  bahrain: { layoutId: "bahrain-1", fileName: "bahrain-1.svg" },
  jeddah: { layoutId: "jeddah-1", fileName: "jeddah-1.svg" },
  miami: { layoutId: "miami-1", fileName: "miami-1.svg" },
  montreal: { layoutId: "montreal-6", fileName: "montreal-6.svg" },
  monaco: { layoutId: "monaco-6", fileName: "monaco-6.svg" },
  barcelona: { layoutId: "catalunya-6", fileName: "catalunya-6.svg" },
  spielberg: { layoutId: "spielberg-3", fileName: "spielberg-3.svg" },
  silverstone: {
    layoutId: "silverstone-8",
    fileName: "silverstone-8.svg",
  },
  spa: {
    layoutId: "spa-francorchamps-4",
    fileName: "spa-francorchamps-4.svg",
  },
  hungaroring: {
    layoutId: "hungaroring-3",
    fileName: "hungaroring-3.svg",
  },
  zandvoort: { layoutId: "zandvoort-5", fileName: "zandvoort-5.svg" },
  monza: { layoutId: "monza-7", fileName: "monza-7.svg" },
  madrid: { layoutId: "madring-1", fileName: "madring-1.svg" },
  baku: { layoutId: "baku-1", fileName: "baku-1.svg" },
  singapore: {
    layoutId: "marina-bay-4",
    fileName: "marina-bay-4.svg",
  },
  austin: { layoutId: "austin-1", fileName: "austin-1.svg" },
  "mexico-city": {
    layoutId: "mexico-city-3",
    fileName: "mexico-city-3.svg",
  },
  "sao-paulo": {
    layoutId: "interlagos-2",
    fileName: "interlagos-2.svg",
  },
  "las-vegas": {
    layoutId: "las-vegas-1",
    fileName: "las-vegas-1.svg",
  },
  lusail: { layoutId: "lusail-1", fileName: "lusail-1.svg" },
  "yas-marina": {
    layoutId: "yas-marina-2",
    fileName: "yas-marina-2.svg",
  },
};

export const CIRCUIT_LAYOUT_SOURCE = {
  label: "Jules Roy · f1-circuits-svg",
  url: "https://github.com/julesr0y/f1-circuits-svg",
  license: "CC BY 4.0",
} as const;

export function circuitLayoutUrl(trackId: TrackPresetId): string {
  return publicAsset(`/circuits/${CIRCUIT_LAYOUTS[trackId].fileName}`);
}
