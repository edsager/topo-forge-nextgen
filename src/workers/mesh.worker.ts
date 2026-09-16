// src/workers/mesh.worker.ts

function hexToRgb(hex: string): [number, number, number] {
    const bigint = parseInt(hex.replace('#', ''), 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

function pointInPolygon(px: number, py: number, polygon: {x:number, y:number}[]) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function pointNearLine(px: number, py: number, line: {x:number, y:number}[], tol: number) {
    for (let i = 0; i < line.length - 1; i++) {
        const x1 = line[i].x, y1 = line[i].y;
        const x2 = line[i+1].x, y2 = line[i+1].y;
        const A = px - x1, B = py - y1;
        const C = x2 - x1, D = y2 - y1;
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        if (lenSq !== 0) param = dot / lenSq;
        let xx, yy;
        if (param < 0) { xx = x1; yy = y1; }
        else if (param > 1) { xx = x2; yy = y2; }
        else { xx = x1 + param * C; yy = y1 + param * D; }
        const dx = px - xx, dy = py - yy;
        if (dx * dx + dy * dy < tol * tol) return true;
    }
    return false;
}

onmessage = async (e) => {
  const { action, payload } = e.data;
  if (action !== 'GENERATE_PUZZLE') return;

  const { 
    zExaggeration, elevationData, elevRows, elevCols, 
    landCoverMask, maskWidth, maskHeight, 
    infrastructureData, bbox,
    puzzleRows, puzzleCols, pieceWidth, pieceDepth, tolerance, waterDrop, colors
  } = payload;

  try {
    const elevPoints = elevationData.data || elevationData || [];
    const eCols = elevationData.cols || elevationData.width || elevCols;
    const eRows = elevationData.rows || elevationData.height || elevRows;

    const maskPoints = landCoverMask ? (landCoverMask.data || landCoverMask) : null;
    const mCols = landCoverMask ? (landCoverMask.cols || landCoverMask.width || maskWidth) : 1;
    const mRows = landCoverMask ? (landCoverMask.rows || landCoverMask.height || maskHeight) : 1;

    const pieces = [];

    const cWater = hexToRgb(colors.water);
    const cDirt = hexToRgb(colors.dirt);
    const cForest = hexToRgb(colors.forest);
    const cRock = hexToRgb(colors.rock);
    const cSnow = hexToRgb(colors.snow);
    const cBldgs = hexToRgb(colors.buildings);
    const cRoads = hexToRgb(colors.roads);

    // Get true minimum elevation (ignoring missing data artifacts) to prevent the "Thick Block" bug
    let minElev = Infinity;
    for (let i = 0; i < elevPoints.length; i++) {
        const val = elevPoints[i];
        if (val !== undefined && !isNaN(val) && val > -10000 && val < minElev) {
            minElev = val;
        }
    }
    if (minElev === Infinity) minElev = 0;

    const latMid = (bbox && bbox.north && bbox.south) ? (bbox.north + bbox.south) / 2 : 40;
    const cosLat = Math.cos(latMid * Math.PI / 180);
    const east = (bbox && bbox.east) ? bbox.east : 0;
    const west = (bbox && bbox.west) ? bbox.west : 0;
    const realWorldWidthMeters = Math.max(1, (east - west) * 111320 * cosLat);
    const totalW = pieceWidth * puzzleCols;
    const scaleY = totalW / realWorldWidthMeters;

    const buildings: {x:number, y:number}[][] = [];
    const roads: {x:number, y:number}[][] = [];
    if (infrastructureData && infrastructureData.elements) {
        for (const el of infrastructureData.elements) {
            if (el.type === 'way' && el.geometry) {
                const pts = el.geometry.map((g: any) => ({
                    x: (g.lon - bbox.west) / (east - west),
                    y: (bbox.north - g.lat) / (bbox.north - bbox.south)
                }));
                if (el.tags && el.tags.building) buildings.push(pts);
                else if (el.tags && el.tags.highway) roads.push(pts);
            }
        }
    }

    for (let pr = 0; pr < puzzleRows; pr++) {
      for (let pc = 0; pc < puzzleCols; pc++) {
        
        const blockVerts: number[] = []; 
        const blockColors: number[] = [];
        const blockFaces: number[] = [];
        
        const gridResX = 25; 
        const gridResY = 25; 
        
        const pieceMinX = (pc * pieceWidth) - (pieceWidth / 2 * (puzzleCols - 1)) + (tolerance / 2);
        const pieceMaxX = pieceMinX + pieceWidth - tolerance;
        const pieceMinZ = (pr * pieceDepth) - (pieceDepth / 2 * (puzzleRows - 1)) + (tolerance / 2);
        const pieceMaxZ = pieceMinZ + pieceDepth - tolerance;

        let minZ_mesh = Infinity;

        for (let i = 0; i <= gridResY; i++) {
          const fracY = i / gridResY;
          const localZ = pieceMinZ + fracY * (pieceMaxZ - pieceMinZ);
          
          for (let j = 0; j <= gridResX; j++) {
            const fracX = j / gridResX;
            const localX = pieceMinX + fracX * (pieceMaxX - pieceMinX);

            const globalFracX = (localX + totalW / 2) / totalW;
            const globalFracY = (localZ + (pieceDepth * puzzleRows) / 2) / (pieceDepth * puzzleRows);

            const elevX = Math.floor(globalFracX * (eCols - 1));
            const elevY = Math.floor(globalFracY * (eRows - 1));
            const elevIdx = Math.max(0, Math.min((elevPoints.length || 1) - 1, elevY * eCols + elevX));
            
            const rawHeight = elevPoints[elevIdx] || 0;
            
            // Fix applied: Subtract sea-level so the puzzle sits perfectly flat on the print bed!
            let h = (rawHeight - minElev) * scaleY * zExaggeration;
            if (isNaN(h)) h = 0;

            let vertexColor = cDirt;

            if (maskPoints && maskPoints.length > 0) {
                const maskX = Math.floor(globalFracX * (mCols - 1));
                const maskY = Math.floor(globalFracY * (mRows - 1));
                const maskIdx = (maskY * mCols + maskX) * 4;
                
                const r = maskPoints[maskIdx] || 0;
                const g = maskPoints[maskIdx + 1] || 0;
                const b = maskPoints[maskIdx + 2] || 0;
                
                let isWater = (r < 50 && g < 50 && b > 150); 
                
                if (isWater) {
                    h -= waterDrop;
                    vertexColor = cWater;
                } else if (g > 150 && r < 100) {
                    vertexColor = cForest;
                } else if (rawHeight > 2000) {
                    vertexColor = cSnow;
                } else if (rawHeight > 1000) {
                    vertexColor = cRock;
                }
            }

            let isBldg = false;
            let isRoad = false;
            for (const bldg of buildings) {
                if (pointInPolygon(globalFracX, globalFracY, bldg)) { isBldg = true; break; }
            }
            if (!isBldg) {
                for (const rd of roads) {
                    if (pointNearLine(globalFracX, globalFracY, rd, 0.0015)) { isRoad = true; break; }
                }
            }
            
            if (isBldg) {
                h += (10 * scaleY * zExaggeration); 
                vertexColor = cBldgs;
            } else if (isRoad) {
                h += (0.5 * scaleY * zExaggeration); 
                vertexColor = cRoads;
            }

            blockVerts.push(localX, h, localZ);
            blockColors.push(vertexColor[0]/255, vertexColor[1]/255, vertexColor[2]/255);
            if (h < minZ_mesh) minZ_mesh = h;
          }
        }

        const baseZ = Math.min(-10, minZ_mesh - 10);

        // FIX: Correctly wound counter-clockwise triangles so the map is visible and outward-facing!
        for (let i = 0; i < gridResY; i++) {
          for (let j = 0; j < gridResX; j++) {
            const v0 = i * (gridResX + 1) + j;
            const v1 = v0 + 1;
            const v2 = (i + 1) * (gridResX + 1) + j;
            const v3 = v2 + 1;

            blockFaces.push(v0, v2, v1);
            blockFaces.push(v1, v2, v3);
          }
        }

        const numTopVerts = blockVerts.length / 3;
        for (let i = 0; i < numTopVerts; i++) {
            blockVerts.push(blockVerts[i*3], baseZ, blockVerts[i*3+2]);
            blockColors.push(0.2, 0.2, 0.2); 
        }

        // Perfectly wound skirt normals for the 3D viewer and Bambu Studio
        for (let j = 0; j < gridResX; j++) {
            const v0 = j, v1 = j + 1;
            const b0 = v0 + numTopVerts, b1 = v1 + numTopVerts;
            blockFaces.push(v0, b0, v1); blockFaces.push(v1, b0, b1);
        }
        for (let j = 0; j < gridResX; j++) {
            const v0 = gridResY * (gridResX + 1) + j;
            const v1 = v0 + 1;
            const b0 = v0 + numTopVerts, b1 = v1 + numTopVerts;
            blockFaces.push(v0, v1, b0); blockFaces.push(v1, b1, b0);
        }
        for (let i = 0; i < gridResY; i++) {
            const v0 = i * (gridResX + 1);
            const v1 = (i + 1) * (gridResX + 1);
            const b0 = v0 + numTopVerts, b1 = v1 + numTopVerts;
            blockFaces.push(v0, v1, b0); blockFaces.push(v1, b1, b0);
        }
        for (let i = 0; i < gridResY; i++) {
            const v0 = i * (gridResX + 1) + gridResX;
            const v1 = (i + 1) * (gridResX + 1) + gridResX;
            const b0 = v0 + numTopVerts, b1 = v1 + numTopVerts;
            blockFaces.push(v0, b0, v1); blockFaces.push(v1, b0, b1);
        }
        
        // Solid bottom cap
        const bTL = numTopVerts;
        const bTR = numTopVerts + gridResX;
        const bBL = numTopVerts + gridResY * (gridResX + 1);
        const bBR = numTopVerts + gridResY * (gridResX + 1) + gridResX;
        blockFaces.push(bTL, bTR, bBL);
        blockFaces.push(bTR, bBR, bBL);

        pieces.push({
          id: `piece_${pr}_${pc}`,
          vertexArray: new Float32Array(blockVerts),
          indexArray: new Uint32Array(blockFaces),
          colorArray: new Float32Array(blockColors) 
        });
      }
    }

    postMessage({ status: 'SUCCESS', pieces });

  } catch (err: any) {
    postMessage({ status: 'ERROR', error: err.message });
  }
};