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
    const pRows = payload.puzzleRows || 1;
    const pCols = payload.puzzleCols || 1;
    const pWidth = payload.pieceWidth || 100;
    const pDepth = payload.pieceDepth || 100;
    const tol = payload.tolerance || 0;
    const zEx = payload.zExaggeration || 1;
    
    const elevPoints = payload.elevationData?.data || payload.elevationData || [];
    const eCols = payload.elevCols || 1;
    const eRows = payload.elevRows || 1;

    const pieces = [];
    const cDirt = hexToRgb(payload.colors?.dirt || '#8B4513');

    for (let pr = 0; pr < pRows; pr++) {
      for (let pc = 0; pc < pCols; pc++) {
        const blockVerts: number[] = [];
        const blockColors: number[] = [];
        const blockFaces: number[] = [];

        const gridResX = 30; 
        const gridResY = 30; 
        
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

            const globalFracX = (localX + (pWidth * pCols) / 2) / (pWidth * pCols);
            const globalFracY = (localZ + (pDepth * pRows) / 2) / (pDepth * pRows);

            const elevX = Math.floor(globalFracX * (eCols - 1));
            const elevY = Math.floor(globalFracY * (eRows - 1));
            const maxIdx = Math.max(0, (elevPoints.length || 1) - 1);
            const elevIdx = Math.max(0, Math.min(maxIdx, elevY * eCols + elevX));
            
            let rawElev = elevPoints[elevIdx];
            if (rawElev === undefined || isNaN(rawElev)) rawElev = 0;

            // Simple visual scaling to ensure it appears on screen
            let h = rawElev * zEx * 0.05; 
            if (isNaN(h)) h = 0;

            blockVerts.push(localX, h, localZ);
            blockColors.push(cDirt[0]/255, cDirt[1]/255, cDirt[2]/255);
            if (h < minZ_mesh) minZ_mesh = h;
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
            blockFaces.push(v0, v1, b0); blockFaces.push(v1, b1, b0);
        }
        blockFaces.push(numTopVerts, numTopVerts + gridResX, numTopVerts + numTopVerts - 1);
        blockFaces.push(numTopVerts, numTopVerts + numTopVerts - 1, numTopVerts + numTopVerts - 1 - gridResX);

        // FIX: Reverting to the native property names your 3D Viewer actually expects
        pieces.push({
          id: `piece_${pr}_${pc}`,
          vertices: new Float32Array(blockVerts),
          indices: new Uint32Array(blockFaces),
          colors: new Float32Array(blockColors),
          // Including these just in case your viewer uses modern BufferGeometry syntax
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