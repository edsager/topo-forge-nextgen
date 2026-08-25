// src/state/projectState.ts

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface ProjectState {
  bbox: BoundingBox | null;
  onBboxChange: (_bbox: BoundingBox | null) => void;
}

export const projectState: ProjectState = {
  bbox: null,
  onBboxChange: (_bbox: BoundingBox | null) => {},
};