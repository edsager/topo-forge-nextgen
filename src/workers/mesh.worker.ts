// src/workers/mesh.worker.ts
import manifoldModule from 'manifold-3d';

let manifoldInstance: any = null;

function hexToRgb(hex: string): [number, number, number] {
    const bigint = parseInt(hex.replace('#', ''), 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

onmessage = async (e) => {
  const { action, payload } = e.data;
  if (action !== 'GENERATE_PUZZLE') return;

  if (!manifoldInstance) {
    try {
      manifoldInstance = await manifoldModule();
      manifoldInstance.setup();
    } catch (err) {
      postMessage({ status: 'ERROR', error: 'Failed to initialize Manifold3D.' });
      return;
    }
  }

  const { Manifold, Mesh } = manifoldInstance;
const { 
    zExaggeration, elevationData, elevRows, elevCols, 
    landCoverMask, maskWidth, maskHeight, 
    puzzleRows, puzzleCols, pieceWidth, pieceDepth, tolerance, waterDrop, colors
  } = payload;

  try {
    // Defensive extraction to completely prevent 'undefined' length errors
    const elevPoints = elevationData.data || elevationData;
    const eCols = elevationData.cols || elevationData.width || elevCols;
    const eRows = elevationData.rows || elevationData.height || elevRows;

    const maskPoints = landCoverMask.data || landCoverMask;
    const mCols = landCoverMask.cols || landCoverMask.width || maskWidth;
    const mRows = landCoverMask.rows || landCoverMask.height || maskHeight;

    const pieces = [];

    const cWater = hexToRgb(colors.water);
    const cDirt = hexToRgb(colors.dirt);
    const cForest = hexToRgb(colors.forest);
    const cRock = hexToRgb(colors.rock);
    const cSnow = hexToRgb(colors.snow);
    // const cRoads = hexToRgb(colors.roads);

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

            const globalFracX = (localX + (pieceWidth * puzzleCols) / 2) / (pieceWidth * puzzleCols);
            const globalFracY = (localZ + (pieceDepth * puzzleRows) / 2) / (pieceDepth * puzzleRows);

            const elevX = Math.floor(globalFracX * (eCols - 1));
            const elevY = Math.floor(globalFracY * (eRows - 1));
            const elevIdx = Math.max(0, Math.min(elevPoints.length - 1, elevY * eCols + elevX));
            
            let h = elevPoints[elevIdx] * zExaggeration;
            
            const maskX = Math.floor(globalFracX * (mCols - 1));
            const maskY = Math.floor(globalFracY * (mRows - 1));
            const maskIdx = (maskY * mCols + maskX) * 4;
            
            const r = maskPoints[maskIdx];
            const g = maskPoints[maskIdx + 1];
            const b = maskPoints[maskIdx + 2];
            
            let isWater = (r < 50 && g < 50 && b > 150); 
            let vertexColor = cDirt;

            if (isWater) {
                h -= waterDrop;
                vertexColor = cWater;
            } else if (g > 150 && r < 100) {
                vertexColor = cForest;
            } else if (h > 2000 * zExaggeration) {
                vertexColor = cSnow;
            } else if (h > 1000 * zExaggeration) {
                vertexColor = cRock;
            }

            blockVerts.push(localX, h, localZ);
            blockColors.push(vertexColor[0]/255, vertexColor[1]/255, vertexColor[2]/255, 1.0);
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
            blockColors.push(0.2, 0.2, 0.2, 1.0); 
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

        try {
          const meshObj = new Mesh({
            vertProperties: new Float32Array(blockVerts),
            numProp: 3,
            triVerts: new Uint32Array(blockFaces),
            runIndex: new Uint32Array([0, blockFaces.length / 3]),
            runOriginalID: new Uint32Array([0]),
            runTransform: new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0]),
          });
          
          let manifoldSolid = new Manifold(meshObj);
          
          pieces.push({
            id: `piece_${pr}_${pc}`,
            vertexArray: manifoldSolid.getMesh().vertProperties,
            indexArray: manifoldSolid.getMesh().triVerts,
            colorArray: new Float32Array(blockColors) 
          });
        } catch (e) {
          console.error("Manifold Boolean failed on piece", pr, pc);
        }
      }
    }

    postMessage({ status: 'SUCCESS', pieces });

  } catch (err: any) {
    postMessage({ status: 'ERROR', error: err.message });
  }
};