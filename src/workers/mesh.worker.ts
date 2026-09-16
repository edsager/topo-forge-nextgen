// src/workers/mesh.worker.ts

function hexToRgb(hex: string): [number, number, number] {
    if (!hex) return [128, 128, 128];
    const bigint = parseInt(hex.replace('#', ''), 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

onmessage = async (e) => {
  const { action, payload } = e.data;
  if (action !== 'GENERATE_PUZZLE') return;

  try {
    const pRows = Math.max(1, payload.puzzleRows || 1);
    const pCols = Math.max(1, payload.puzzleCols || 1);
    const pWidth = Math.max(1, payload.pieceWidth || 100);
    const pDepth = Math.max(1, payload.pieceDepth || 100);
    const tol = payload.tolerance || 0;
    const zEx = payload.zExaggeration || 1.5;
    const wDrop = payload.waterDrop || 0;
    const bbox = payload.bbox;

    const elevData = payload.elevationData || {};
    const rawElevData = elevData.data || elevData || [];
    const eCols = payload.elevCols || elevData.width || 1;
    const eRows = payload.elevRows || elevData.height || 1;

    let flatElev: number[] = [];
    if (rawElevData.length > 0) {
        if (Array.isArray(rawElevData[0]) || rawElevData[0] instanceof Float32Array) {
            for (let r = 0; r < rawElevData.length; r++) {
                for (let c = 0; c < rawElevData[r].length; c++) {
                    flatElev.push(Number(rawElevData[r][c]));
                }
            }
        } else if (typeof rawElevData[0] === 'object' && rawElevData[0] !== null && 'elevation' in rawElevData[0]) {
            for (let i = 0; i < rawElevData.length; i++) {
                flatElev.push(Number(rawElevData[i].elevation));
            }
        } else {
            flatElev = Array.from(rawElevData) as number[];
        }
    }

    const maskData = payload.landCoverMask || {};
    const maskPoints: number[] = Array.from(maskData.data || maskData || []) as number[];
    const mCols = payload.maskWidth || maskData.width || 1;
    const mRows = payload.maskHeight || maskData.height || 1;

    const pieces = [];

    const cWater = hexToRgb(payload.colors?.water || '#1E90FF');
    const cDirt = hexToRgb(payload.colors?.dirt || '#8B4513');
    const cForest = hexToRgb(payload.colors?.forest || '#228B22');
    const cRock = hexToRgb(payload.colors?.rock || '#808080');
    const cSnow = hexToRgb(payload.colors?.snow || '#FFFFFF');

    let minElev = Infinity;
    for (let i = 0; i < flatElev.length; i++) {
        const val = flatElev[i];
        if (val !== undefined && !isNaN(val) && val > -10000 && val < minElev) {
            minElev = val;
        }
    }
    if (minElev === Infinity) minElev = 0;

    const latMid = (bbox && bbox.north && bbox.south) ? (bbox.north + bbox.south) / 2 : 40;
    const cosLat = Math.cos(latMid * Math.PI / 180);
    const east = (bbox && bbox.east) ? bbox.east : 0;
    const west = (bbox && bbox.west) ? bbox.west : 0;
    const realWorldWidthMeters = Math.max(1, Math.abs(east - west) * 111320 * cosLat);
    
    const totalW = pWidth * pCols;
    const totalD = pDepth * pRows;
    const scaleY = totalW / realWorldWidthMeters;

    for (let pr = 0; pr < pRows; pr++) {
      for (let pc = 0; pc < pCols; pc++) {
        const blockVerts: number[] = [];
        const blockColors: number[] = [];
        const blockFaces: number[] = [];

        const gridResX = 40; 
        const gridResY = 40; 
        
        const pieceMinX = -totalW / 2 + (pc * pWidth) + (tol / 2);
        const pieceMaxX = pieceMinX + pWidth - tol;
        const pieceMinZ = -totalD / 2 + (pr * pDepth) + (tol / 2);
        const pieceMaxZ = pieceMinZ + pDepth - tol;

        let minZ_mesh = Infinity;

        for (let i = 0; i <= gridResY; i++) {
          const fracY = i / gridResY;
          const localZ = pieceMinZ + fracY * (pieceMaxZ - pieceMinZ);
          
          for (let j = 0; j <= gridResX; j++) {
            const fracX = j / gridResX;
            const localX = pieceMinX + fracX * (pieceMaxX - pieceMinX);

            const globalFracX = (localX + totalW / 2) / totalW;
            const globalFracY = (localZ + totalD / 2) / totalD;

            const elevX = Math.floor(globalFracX * (eCols - 1));
            const elevY = Math.floor(globalFracY * (eRows - 1));
            const maxIdx = Math.max(0, (flatElev.length || 1) - 1);
            const elevIdx = Math.max(0, Math.min(maxIdx, elevY * eCols + elevX));
            
            let rawElev = flatElev[elevIdx];
            if (rawElev === undefined || isNaN(rawElev)) rawElev = minElev;

            let h = (rawElev - minElev) * scaleY * zEx; 
            if (isNaN(h)) h = 0;

            let vertexColor = cDirt;

            if (maskPoints && maskPoints.length > 0) {
                const maskX = Math.floor(globalFracX * (mCols - 1));
                const maskY = Math.floor(globalFracY * (mRows - 1));
                const maskIdx = (maskY * mCols + maskX) * 4;
                
                // FIXED: Strictly typed as numbers to clear the compilation error
                const r = Number(maskPoints[maskIdx]) || 0;
                const g = Number(maskPoints[maskIdx + 1]) || 0;
                const b = Number(maskPoints[maskIdx + 2]) || 0;
                
                const isWater = (r < 50 && g < 50 && b > 150); 
                
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