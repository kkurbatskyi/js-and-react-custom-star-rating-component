/** The captured photo being previewed in photo mode (lives outside React so Escape can close it). */
import { create } from 'zustand';

export interface Shot {
  url: string;
  name: string;
  takenAt: number;
}

interface PhotoStore {
  shot: Shot | null;
  setShot(shot: Shot | null): void;
}

export const usePhotoStore = create<PhotoStore>()((set, get) => ({
  shot: null,
  setShot: (shot) => {
    const previous = get().shot;
    if (previous && previous.url !== shot?.url) URL.revokeObjectURL(previous.url);
    set({ shot });
  },
}));
