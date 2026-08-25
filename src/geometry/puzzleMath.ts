export interface Vector2 { x: number; y: number; }

/**
 * Generates the 2D path for a puzzle edge with a dovetail interlock.
 * @param pStart The starting vertex of the edge.
 * @param pEnd The ending vertex of the edge.
 * @param isTab True if this piece has the protruding tab; false if it receives the socket.
 * @param toleranceMm The gap to leave for printer expansion.
 * @returns Array of Vector2 points defining the interlocking edge.
 */
export function generateDovetailEdge(
  pStart: Vector2, 
  pEnd: Vector2, 
  isTab: boolean, 
  toleranceMm: number = 0.15
): Vector2[] {
  // Base dimensions of the dovetail connector (in mm)
  const baseNeckWidth = 10.0; // Width at the narrowest point
  const baseHeadWidth = 16.0; // Width at the widest point
  const baseDepth = 8.0;      // How far the tab protrudes

  // Apply machine tolerance
  // Tabs get slightly smaller, slots get slightly larger
  const offset = isTab ? -toleranceMm : toleranceMm;
  const neckWidth = baseNeckWidth + offset;
  const headWidth = baseHeadWidth + offset;
  
  // Depth tolerance applies to the 'tip' of the tab and the 'bottom' of the slot
  const depth = baseDepth + offset;
  const sign = isTab ? 1 : -1;

  // Edge Vector Math
  const dx = pEnd.x - pStart.x;
  const dy = pEnd.y - pStart.y;
  const length = Math.hypot(dx, dy);
  
  // Normalized direction vector (parallel to the edge)
  const ux = dx / length;
  const uy = dy / length;
  
  // Normalized normal vector (perpendicular to the edge, pointing outward)
  const nx = -uy;
  const ny = ux;

  const mid = length / 2;

  // Calculate the distances along the edge for the dovetail cuts
  const t1 = mid - (neckWidth / 2);
  const t2 = mid - (headWidth / 2);
  const t3 = mid + (headWidth / 2);
  const t4 = mid + (neckWidth / 2);

  return [
    pStart,
    // Start of the neck
    { x: pStart.x + ux * t1, y: pStart.y + uy * t1 },
    // Base of the flared head
    { 
      x: pStart.x + ux * t2 + (nx * depth * sign), 
      y: pStart.y + uy * t2 + (ny * depth * sign) 
    },
    // Top of the flared head
    { 
      x: pStart.x + ux * t3 + (nx * depth * sign), 
      y: pStart.y + uy * t3 + (ny * depth * sign) 
    },
    // Return to the neck
    { x: pStart.x + ux * t4, y: pStart.y + uy * t4 },
    pEnd
  ];
}