// src/workers/mesh.worker.ts

function hexToRgb(hex: string): [number, number, number] {
    if (!hex) return [128, 128, 128]; // Failsafe grey
    const bigint = parseInt(hex.replace('#', ''), 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

// The "NaN Killer": Forces any missing or broken data to become a safe 0
function cleanNum(num: any): number {
    const parsed = Number(num);
    return isNaN(parsed) ? 0 : parsed;
}

onmessage = async (e) => {
  const { action, payload } = e.data;
  if (action !== 'GENERATE_PUZZLE') return;

  try {
    // Sanitize ALL incoming configuration variables
    const zEx = cleanNum(payload.zExaggeration) || 1.5;
    const pRows = Math.max(1, cleanNum(payload.puzzleRows));
    const pCols = Math.max(1, cleanNum(payload.puzzleCols));
    const pWidth = cleanNum(payload.pieceWidth);
    const pDepth = cleanNum(payload.pieceDepth);
    const tol = cleanNum(payload.tolerance);
    const wDrop = cleanNum(payload.waterDrop);

    const elevData = payload.elevationData || {};
    const elevPoints = elevData.data || elevData || [];
    const eCols = cleanNum(elevData.cols || elevData.width || payload.elevCols) || 1;
    const eRows = cleanNum(elevData.rows || elevData.height || payload.elevRows) || 1;
    
    const maskData = payload.landCoverMask || {};
    const maskPoints = maskData.data || maskData || [];
    const mCols = cleanNum(maskData.cols || maskData.width || payload.maskWidth) || 1;
    const mRows = cleanNum(maskData.rows || maskData.height || payload.maskHeight) || 1;

    const pieces = [];

    const cWater = hexToRgb(payload.colors?.water);
    const cDirt = hexToRgb(payload.colors?.dirt);
    const cForest = hexToRgb(payload.colors?.forest);
    const cRock = hexToRgb(payload.colors?.rock);
    const cSnow = hexToRgb(payload.colors?.snow);

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

            const globalFracX = pWidth * pCols === 0 ? 0 : (localX + (pWidth * pCols) / 2) / (pWidth * pCols);
            const globalFracY = pDepth * pRows === 0 ? 0 : (localZ + (pDepth * pRows) / 2) / (pDepth * pRows);

            const elevX = Math.floor(globalFracX * (eCols - 1));
            const elevY = Math.floor(globalFracY * (eRows - 1));
            
            const maxIdx = Math.max(0, (elevPoints.length || 1) - 1);
            const elevIdx = Math.max(0, Math.min(maxIdx, elevY * eCols + elevX));
            
            // Protect against missing API data
            let rawElev = elevPoints[elevIdx];
            if (rawElev === undefined || isNaN(rawElev)) rawElev = 0;

            let h = rawElev * zEx * 0.05; 
            let vertexColor = cDirt;

            if (maskPoints && maskPoints.length > 0) {
                const maskX = Math.floor(globalFracX * (mCols - 1));
                const maskY = Math.floor(globalFracY * (mRows - 1));
                const maskIdx = (maskY * mCols + maskX) * 4;
                
                const r = cleanNum(maskPoints[maskIdx]);
                const g = cleanNum(maskPoints[maskIdx + 1]);
                const b = cleanNum(maskPoints[maskIdx + 2]);
                
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
            }

            // Final Absolute Failsafe before entering the 3D array
            const finalX = cleanNum(localX);
            const finalY = cleanNum(h);
            const finalZ = cleanNum(localZ);

            blockVerts.push(finalX, finalY, finalZ);
            blockColors.push(cleanNum(vertexColor[0]/255), cleanNum(vertexColor[1]/255), cleanNum(vertexColor[2]/255));
            if (finalY < minZ_mesh) minZ_mesh = finalY;
          }
        }

        const baseZ = Math.min(-10, minZ_mesh - 10);

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
            blockFaces.push(v0, v1, b0); blockFaces.push(v1, b1, b0);
        }
        for (let j = 0; j < gridResX; j++) {
            const v0 = gridResY * (gridResX + 1) + j;
            const v1 = v0 + 1;
            const b0 = v0 + numTopVerts, b1 = v1 + numTopVerts;
            blockFaces.push(v0, b0, v1); blockFaces.push(v1, b0, b1);
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
        blockFaces.push(numTopVerts, numTopVerts + gridResX, numTopVerts + numTopVerts - 1);
        blockFaces.push(numTopVerts, numTopVerts + numTopVerts - 1, numTopVerts + numTopVerts - 1 - gridResX);

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