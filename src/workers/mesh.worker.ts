// src/workers/mesh.worker.ts

function hexToRgb(hex: string): [number, number, number] {
    const bigint = parseInt(hex.replace('#', ''), 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

onmessage = async (e) => {
  const { action, payload } = e.data;
  if (action !== 'GENERATE_PUZZLE') return;

  const { 
    zExaggeration, elevationData, elevRows, elevCols, 
    landCoverMask, maskWidth, maskHeight, 
    bbox, 
    puzzleRows, puzzleCols, pieceWidth, pieceDepth, tolerance, waterDrop, colors
  } = payload;

  try {
    const elevPoints = elevationData.data || elevationData;
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

    // FIX 1: Calculate real-world scale so mountains aren't 4 feet tall on the screen!
    const latMid = (bbox.north + bbox.south) / 2;
    const cosLat = Math.cos(latMid * Math.PI / 180);
    const realWorldWidthMeters = (bbox.east - bbox.west) * 111320 * cosLat;
    const totalW = pieceWidth * puzzleCols;
    const scaleY = totalW / realWorldWidthMeters; // Converts meters to scaled millimeters

    for (let pr = 0; pr < puzzleRows; pr++) {
      for (let pc = 0; pc < puzzleCols; pc++) {
        
        const blockVerts = [];
        const blockFaces = [];
        const blockColors = [];
        const gridResX = 40; 
        const gridResY = 40; 
        
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
            const elevIdx = Math.max(0, Math.min(elevPoints.length - 1, elevY * eCols + elevX));
            
            // APPLY THE Y-SCALE HERE
            let h = elevPoints[elevIdx] * scaleY * zExaggeration;
            let vertexColor = cDirt;

            if (maskPoints && maskPoints.length > 0) {
                const maskX = Math.floor(globalFracX * (mCols - 1));
                const maskY = Math.floor(globalFracY * (mRows - 1));
                const maskIdx = (maskY * mCols + maskX) * 4;
                
                const r = maskPoints[maskIdx];
                const g = maskPoints[maskIdx + 1];
                const b = maskPoints[maskIdx + 2];
                
                let isWater = (r < 50 && g < 50 && b > 150); 
                
                if (isWater) {
                    h -= waterDrop;
                    vertexColor = cWater;
                } else if (g > 150 && r < 100) {
                    vertexColor = cForest;
                } else if (elevPoints[elevIdx] > 2000) { // Check real absolute elevation for snow
                    vertexColor = cSnow;
                } else if (elevPoints[elevIdx] > 1000) { // Check real absolute elevation for rock
                    vertexColor = cRock;
                }
            }

            blockVerts.push(localX, h, localZ);
            
            // FIX 2: Only push 3 values (RGB) so the color buffer matches perfectly
            blockColors.push(vertexColor[0]/255, vertexColor[1]/255, vertexColor[2]/255);
            
            if (h < minZ_mesh) minZ_mesh = h;
          }
        }

        const baseZ = Math.min(-10, minZ_mesh - 10);

        // Top Faces
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

        // Skirt/Base Vertices
        const numTopVerts = blockVerts.length / 3;
        for (let i = 0; i < numTopVerts; i++) {
            blockVerts.push(blockVerts[i*3], baseZ, blockVerts[i*3+2]);
            blockColors.push(0.2, 0.2, 0.2); // RGB dark grey for the base
        }

        // Wall Faces
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
        
        // Bottom Faces
        blockFaces.push(numTopVerts, numTopVerts + gridResX, numTopVerts + numTopVerts - 1);
        blockFaces.push(numTopVerts, numTopVerts + numTopVerts - 1, numTopVerts + numTopVerts - 1 - gridResX);

        // Output raw arrays directly to Three.js viewer
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