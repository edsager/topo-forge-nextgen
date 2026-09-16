// src/workers/mesh.worker.ts

function hexToRgb(hex: string): [number, number, number] {
    if (!hex) return [128, 128, 128]; // Failsafe
    const bigint = parseInt(hex.replace('#', ''), 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

onmessage = async (e) => {
  const { action, payload } = e.data;
  if (action !== 'GENERATE_PUZZLE') return;

  try {
    const pRows = payload.puzzleRows || 1;
    const pCols = payload.puzzleCols || 1;
    const pWidth = payload.pieceWidth || 100;
    const pDepth = payload.pieceDepth || 100;
    const tol = payload.tolerance || 0;
    const zEx = payload.zExaggeration || 1.5;
    const wDrop = payload.waterDrop || 0;
    const bbox = payload.bbox;

    const elevData = payload.elevationData || {};
    const elevPoints = elevData.data || elevData || [];
    const eCols = payload.elevCols || elevData.width || 1;
    const eRows = payload.elevRows || elevData.height || 1;

    // FIX 1: Properly unpacking the Land Cover data so colors actually apply!
    const maskData = payload.landCoverMask || {};
    const maskPoints = maskData.data || maskData || [];
    const mCols = payload.maskWidth || maskData.width || 1;
    const mRows = payload.maskHeight || maskData.height || 1;

    const pieces = [];

    const cWater = hexToRgb(payload.colors?.water || '#1E90FF');
    const cDirt = hexToRgb(payload.colors?.dirt || '#8B4513');
    const cForest = hexToRgb(payload.colors?.forest || '#228B22');
    const cRock = hexToRgb(payload.colors?.rock || '#808080');
    const cSnow = hexToRgb(payload.colors?.snow || '#FFFFFF');

    // FIX 2: Find absolute minimum elevation so we can subtract the sea-level floor
    let minElev = Infinity;
    for (let i = 0; i < elevPoints.length; i++) {
        const val = elevPoints[i];
        if (val !== undefined && !isNaN(val) && val > -10000 && val < minElev) {
            minElev = val;
        }
    }
    if (minElev === Infinity) minElev = 0;

    // Mathematical real-world scaling
    const latMid = (bbox && bbox.north && bbox.south) ? (bbox.north + bbox.south) / 2 : 40;
    const cosLat = Math.cos(latMid * Math.PI / 180);
    const east = (bbox && bbox.east) ? bbox.east : 0;
    const west = (bbox && bbox.west) ? bbox.west : 0;
    const realWorldWidthMeters = Math.max(1, (east - west) * 111320 * cosLat);
    const totalW = pWidth * pCols;
    const scaleY = totalW / realWorldWidthMeters;

    for (let pr = 0; pr < pRows; pr++) {
      for (let pc = 0; pc < pCols; pc++) {
        const blockVerts: number[] = [];
        const blockColors: number[] = [];
        const blockFaces: number[] = [];

        const gridResX = 40; 
        const gridResY = 40; 
        
        const pieceMinX = (pc * pWidth) - (pWidth / 2 * (pCols - 1)) + (tol / 2);
        const pieceMaxX = pieceMinX + pWidth - tol;
        const pieceMinZ = (pr * pDepth) - (pDepth / 2 * (pRows - 1)) + (tol / 2);
        const pieceMaxZ = pieceMinZ + pDepth - tol;

        let minZ_mesh = Infinity;

        for (let i = 0; i <= gridResY; i++) {
          const fracY = i / gridResY;
          const localZ = pieceMinZ + fracY * (pieceMaxZ - pieceMinZ);
          
          for (let j = 0; j <= gridResX; j++) {
            const fracX = j / gridResX;
            const localX = pieceMinX + fracX * (pieceMaxX - pieceMinX);

            const globalFracX = (localX + totalW / 2) / totalW;
            const globalFracY = (localZ + (pDepth * pRows) / 2) / (pDepth * pRows);

            const elevX = Math.floor(globalFracX * (eCols - 1));
            const elevY = Math.floor(globalFracY * (eRows - 1));
            const maxIdx = Math.max(0, (elevPoints.length || 1) - 1);
            const elevIdx = Math.max(0, Math.min(maxIdx, elevY * eCols + elevX));
            
            let rawElev = elevPoints[elevIdx];
            if (rawElev === undefined || isNaN(rawElev)) rawElev = minElev;

            // Subtract floor and apply accurate scaling!
            let h = (rawElev - minElev) * scaleY * zEx; 
            if (isNaN(h)) h = 0;

            let vertexColor = cDirt;

            // Apply Land Cover Mask
            if (maskPoints && maskPoints.length > 0) {
                const maskX = Math.floor(globalFracX * (mCols - 1));
                const maskY = Math.floor(globalFracY * (mRows - 1));
                const maskIdx = (maskY * mCols + maskX) * 4;
                
                const r = maskPoints[maskIdx] || 0;
                const g = maskPoints[maskIdx + 1] || 0;
                const b = maskPoints[maskIdx + 2] || 0;
                
                let isWater = (r < 50 && g < 50 && b > 150); 
                
                if (isWater) {
                    h -= wDrop;
                    vertexColor = cWater;
                } else if (g > 150 && r < 100) {
                    vertexColor = cForest;
                } else if (rawElev > 2000) { 
                    vertexColor = cSnow;
                } else if (rawElev > 1000) { 
                    vertexColor = cRock;
                }
            } else {
                if (rawElev > 2000) vertexColor = cSnow;
                else if (rawElev > 1000) vertexColor = cRock;
            }

            blockVerts.push(localX, h, localZ);
            blockColors.push(vertexColor[0]/255, vertexColor[1]/255, vertexColor[2]/255);
            if (h < minZ_mesh) minZ_mesh = h;
          }
        }

        const baseZ = Math.min(-5, minZ_mesh - 5);

        // Correct counter-clockwise triangle winding for browser visibility
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
            blockFaces.push(v0, b0, v1); blockFaces.push(v1, b0, b1);
        }
        for (let i = 0; i < gridResY; i++) {
            const v0 = i * (gridResX + 1) + gridResX;
            const v1 = (i + 1) * (gridResX + 1) + gridResX;
            const b0 = v0 + numTopVerts, b1 = v1 + numTopVerts;
            blockFaces.push(v0, v1, b0); blockFaces.push(v1, b1, b0);
        }
        
        // Solid bottom cap
        const bTL = numTopVerts;
        const bTR = numTopVerts + gridResX;
        const bBL = numTopVerts + gridResY * (gridResX + 1);
        const bBR = numTopVerts + gridResY * (gridResX + 1) + gridResX;
        
        blockFaces.push(bTL, bBL, bTR);
        blockFaces.push(bTR, bBL, bBR);

        pieces.push({
          id: `piece_${pr}_${pc}`,
          vertices: new Float32Array(blockVerts),
          indices: new Uint32Array(blockFaces),
          colors: new Float32Array(blockColors),
          positions: new Float32Array(blockVerts),
          vertexArray: new Float32Array(blockVerts)
        });
      }
    }

    postMessage({ status: 'SUCCESS', pieces });

  } catch (err: any) {
    postMessage({ status: 'ERROR', error: err.message });
  }
};