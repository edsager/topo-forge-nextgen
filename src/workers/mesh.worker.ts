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

    // Failsafe calculations to scale the physical world down to your 3D printer bed
    const latMid = (bbox && bbox.north && bbox.south) ? (bbox.north + bbox.south) / 2 : 40;
    const cosLat = Math.cos(latMid * Math.PI / 180);
    const east = (bbox && bbox.east) ? bbox.east : 0;
    const west = (bbox && bbox.west) ? bbox.west : 0;
    const realWorldWidthMeters = Math.max(1, (east - west) * 111320 * cosLat);
    const totalW = pieceWidth * puzzleCols;
    const scaleY = totalW / realWorldWidthMeters;

    for (let pr = 0; pr < puzzleRows; pr++) {
      for (let pc = 0; pc < puzzleCols; pc++) {
        
        // Explicitly telling TypeScript these are arrays of numbers to fix the compiler error
        const blockVertsAndColors: number[] = []; 
        const blockFaces: number[] = [];
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
            const elevIdx = Math.max(0, Math.min((elevPoints.length || 1) - 1, elevY * eCols + elevX));
            
            const rawHeight = elevPoints[elevIdx] || 0;
            let h = rawHeight * scaleY * zExaggeration;
            
            if (isNaN(h)) h = 0; // Absolute failsafe against missing data

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

            // Pushing exactly 6 values into the array (X,Y,Z, R,G,B)
            blockVertsAndColors.push(localX, h, localZ, vertexColor[0]/255, vertexColor[1]/255, vertexColor[2]/255);
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

        const numTopVerts = blockVertsAndColors.length / 6;
        for (let i = 0; i < numTopVerts; i++) {
            const origX = blockVertsAndColors[i*6];
            const origZ = blockVertsAndColors[i*6 + 2];
            blockVertsAndColors.push(origX, baseZ, origZ, 0.2, 0.2, 0.2); 
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
          // Handing the heavy geometry over to Manifold to optimize
          const meshObj = new Mesh({
            vertProperties: new Float32Array(blockVertsAndColors),
            numProp: 6, // CRUCIAL: Tells Manifold it holds 3 positions + 3 colors
            triVerts: new Uint32Array(blockFaces),
            runIndex: new Uint32Array([0, blockFaces.length / 3]),
            runOriginalID: new Uint32Array([0]),
            runTransform: new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0]),
          });
          
          let manifoldSolid = new Manifold(meshObj);
          let outMesh = manifoldSolid.getMesh();
          
          // Unpacking Manifold's optimized output back into separate files for Three.js
          const finalVerts = new Float32Array((outMesh.vertProperties.length / 6) * 3);
          const finalColors = new Float32Array((outMesh.vertProperties.length / 6) * 3);
          
          let vIdx = 0, cIdx = 0;
          for (let i = 0; i < outMesh.vertProperties.length; i += 6) {
              finalVerts[vIdx++] = outMesh.vertProperties[i];
              finalVerts[vIdx++] = outMesh.vertProperties[i+1];
              finalVerts[vIdx++] = outMesh.vertProperties[i+2];
              
              finalColors[cIdx++] = outMesh.vertProperties[i+3];
              finalColors[cIdx++] = outMesh.vertProperties[i+4];
              finalColors[cIdx++] = outMesh.vertProperties[i+5];
          }

          pieces.push({
            id: `piece_${pr}_${pc}`,
            vertexArray: finalVerts,
            indexArray: outMesh.triVerts,
            colorArray: finalColors 
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