import { generateDovetailEdge } from './puzzleMath';
import type { Vector2 } from './puzzleMath';

export interface MeshPiece {
  gridRow: number;
  gridCol: number;
  positions: Float32Array;
  indices: Uint32Array;
  materials: Uint8Array;
}

/**
 * Calculates the interlocking perimeter for a specific puzzle piece.
 */
export function buildPiecePerimeter(
  row: number, col: number, 
  totalRows: number, totalCols: number, 
  pieceWidth: number, pieceDepth: number,
  toleranceMm: number = 0.15
): Vector2[] {
  // Center origin of the piece
  const x0 = (col * pieceWidth) - ((totalCols * pieceWidth) / 2);
  const x1 = x0 + pieceWidth;
  const y0 = ((totalRows * pieceDepth) / 2) - (row * pieceDepth);
  const y1 = y0 - pieceDepth;

  // Corners
  const nw = { x: x0, y: y0 };
  const ne = { x: x1, y: y0 };
  const sw = { x: x0, y: y1 };
  const se = { x: x1, y: y1 };

  // Checkerboard logic ensures tabs and slots perfectly alternate and mate
  const isNorthTab = (row % 2 === 0) ? (col % 2 !== 0) : (col % 2 === 0);
  const isSouthTab = !isNorthTab;
  const isEastTab = (row % 2 === 0) ? (col % 2 === 0) : (col % 2 !== 0);
  const isWestTab = !isEastTab;

  // Generate the 4 edges. 
  // If it's an outer border (e.g., row === 0 for North), keep it a straight line.
  const northEdge = (row === 0) 
    ? [nw, ne] 
    : generateDovetailEdge(nw, ne, isNorthTab, toleranceMm);
    
  const eastEdge = (col === totalCols - 1) 
    ? [ne, se] 
    : generateDovetailEdge(ne, se, isEastTab, toleranceMm);
    
  const southEdge = (row === totalRows - 1) 
    ? [se, sw] 
    : generateDovetailEdge(se, sw, isSouthTab, toleranceMm);
    
  const westEdge = (col === 0) 
    ? [sw, nw] 
    : generateDovetailEdge(sw, nw, isWestTab, toleranceMm);

  // Combine into a single continuous perimeter loop
  return [...northEdge, ...eastEdge.slice(1), ...southEdge.slice(1), ...westEdge.slice(1, -1)];
}

// In the next iteration, we will use this perimeter to sample the elevation grid 
// and drop the vertices to Z=0 to seal the walls.