// File: src/workers/mesh.worker.ts
export {}; 

// @ts-ignore
import Module from 'manifold-3d';

let wasm: any = null;

interface RGB { r: number, g: number, b: number }

const colorWater = {r: 0, g: 105, b: 148};   
const colorTrail = {r: 255, g: 50, b: 50};   
const colorRoad = {r: 80, g: 80, b: 80}; // Dark Asphalt Grey  
const colorBase = {r: 210, g: 180, b: 140};  

const TERRAIN_SPOOLS = [
    {r: 210, g: 180, b: 140}, // Priority 1: Tan / Sand / Dirt
    {r: 34, g: 100, b: 34},   // Priority 2: Forest Green
    {r: 255, g: 255, b: 255}, // Priority 3: Snow White
    {r: 120, g: 120, b: 120}, // Priority 4: Granite Grey
    {r: 60, g: 60, b: 60}     // Priority 5: Dark Rock
];

function rgbToHsl(r: number, g: number, b: number) {
    r /= 255, g /= 255, b /= 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return {h, s, l};
}

function sampleElev(elev: any, fRow: number, fCol: number) {
  const { grid, rows, cols } = elev;
  const r0 = Math.max(0, Math.min(rows - 1, Math.floor(fRow)));
  const c0 = Math.max(0, Math.min(cols - 1, Math.floor(fCol)));
  const r1 = Math.min(rows - 1, r0 + 1);
  const c1 = Math.min(cols - 1, c0 + 1);
  const dr = fRow - r0;
  const dc = fCol - c0;
  return grid[r0][c0]*(1-dr)*(1-dc) + grid[r0][c1]*(1-dr)*dc + grid[r1][c0]*dr*(1-dc) + grid[r1][c1]*dr*dc;
}

function getBezierPoint(t: number, p0: any, p1: any, p2: any, p3: any) {
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;
    return {
        x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
        y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y
    };
}

function buildJigsawEdge(pStart: any, pEnd: any, isTab: boolean, toleranceMm: number) {
    const dx = pEnd.x - pStart.x, dy = pEnd.y - pStart.y;
    const length = Math.hypot(dx, dy);
    const ux = dx / length, uy = dy / length;
    const nx = -uy, ny = ux;
    const sign = isTab ? 1 : -1;

    const maxTabWidth = length * 0.35;
    const scale = Math.min(1.0, maxTabWidth / 32.0);

    const tempPoints = [];
    const steps = 8; 
    
    for(let i=0; i<=steps; i++) tempPoints.push(getBezierPoint(i/steps, {x:-16,y:0}, {x:-10,y:0}, {x:-6,y:2}, {x:-6,y:6}));
    for(let i=1; i<=steps; i++) tempPoints.push(getBezierPoint(i/steps, {x:-6,y:6}, {x:-6,y:10}, {x:-12,y:10}, {x:-10,y:14}));
    for(let i=1; i<=steps; i++) tempPoints.push(getBezierPoint(i/steps, {x:-10,y:14}, {x:-8,y:18}, {x:-4,y:18}, {x:0,y:18}));
    for(let i=1; i<=steps; i++) tempPoints.push(getBezierPoint(i/steps, {x:0,y:18}, {x:4,y:18}, {x:8,y:18}, {x:10,y:14}));
    for(let i=1; i<=steps; i++) tempPoints.push(getBezierPoint(i/steps, {x:10,y:14}, {x:12,y:10}, {x:6,y:10}, {x:6,y:6}));
    for(let i=1; i<=steps; i++) tempPoints.push(getBezierPoint(i/steps, {x:6,y:6}, {x:6,y:2}, {x:10,y:0}, {x:16,y:0}));

    const localPoints = [];
    localPoints.push({ x: 0, y: 0 });
    localPoints.push({ x: (length / 2) + (tempPoints[0].x * scale) - 0.1, y: 0 }); 
    
    for (let i = 0; i < tempPoints.length; i++) {
        localPoints.push({ 
            x: (length / 2) + (tempPoints[i].x * scale), 
            y: tempPoints[i].y * scale * sign 
        });
    }
    
    localPoints.push({ x: (length / 2) + (tempPoints[tempPoints.length-1].x * scale) + 0.1, y: 0 });
    localPoints.push({ x: length, y: 0 });

    const inset = toleranceMm / 2.0;
    const offsetPoints = [];
    for (let i = 0; i < localPoints.length; i++) {
        let prev = i === 0 ? {x: localPoints[0].x - 1, y: localPoints[0].y} : localPoints[i-1];
        let next = i === localPoints.length - 1 ? {x: localPoints[i].x + 1, y: localPoints[i].y} : localPoints[i+1];
        
        let l_dx = next.x - prev.x;
        let l_dy = next.y - prev.y;
        let len = Math.hypot(l_dx, l_dy);
        let l_nx = l_dy / len;
        let l_ny = -l_dx / len;
        
        offsetPoints.push({
            x: localPoints[i].x + l_nx * inset,
            y: localPoints[i].y + l_ny * inset
        });
    }

    const worldPoints = [];
    for (let i = 0; i < offsetPoints.length; i++) {
        const p = offsetPoints[i];
        worldPoints.push({
            x: pStart.x + ux * p.x + nx * p.y,
            y: pStart.y + uy * p.x + ny * p.y
        });
    }

    return worldPoints;
}

function extractKMeansPalette(imageData: Uint8ClampedArray, k: number, maxIterations: number = 10): { raw: RGB, ams: RGB }[] {
  const pixels: RGB[] = [];
  const stride = 4 * 4; 
  for (let i = 0; i < imageData.length; i += stride) {
    if (imageData[i+3] > 0) pixels.push({ r: imageData[i], g: imageData[i+1], b: imageData[i+2] });
  }
  if (pixels.length === 0) return [{ raw: colorBase, ams: colorBase }];

  const centroids: RGB[] = [];
  for (let i = 0; i < k; i++) centroids.push({ ...pixels[Math.floor(Math.random() * pixels.length)] });

  for (let iter = 0; iter < maxIterations; iter++) {
    const clusters: RGB[][] = Array.from({ length: k }, () => []);
    for (const p of pixels) {
      let minDist = Infinity;
      let bestIdx = 0;
      for (let i = 0; i < k; i++) {
        const c = centroids[i];
        const distSq = (p.r - c.r)**2 + (p.g - c.g)**2 + (p.b - c.b)**2;
        if (distSq < minDist) { minDist = distSq; bestIdx = i; }
      }
      clusters[bestIdx].push(p);
    }
    let moved = false;
    for (let i = 0; i < k; i++) {
      const cluster = clusters[i];
      if (cluster.length === 0) continue;
      let sumR = 0, sumG = 0, sumB = 0;
      for (const p of cluster) { sumR += p.r; sumG += p.g; sumB += p.b; }
      const newR = Math.round(sumR / cluster.length);
      const newG = Math.round(sumG / cluster.length);
      const newB = Math.round(sumB / cluster.length);
      if (Math.abs(centroids[i].r - newR) > 1 || Math.abs(centroids[i].g - newG) > 1 || Math.abs(centroids[i].b - newB) > 1) moved = true;
      centroids[i] = { r: newR, g: newG, b: newB };
    }
    if (!moved) break;
  }
  
  const activeSpools = TERRAIN_SPOOLS.slice(0, k);
  
  return centroids.map(c => {
     let bestDist = Infinity;
     let bestSpool = activeSpools[0];
     for (const spool of activeSpools) {
         const d = (c.r-spool.r)**2 + (c.g-spool.g)**2 + (c.b-spool.b)**2;
         if (d < bestDist) { bestDist = d; bestSpool = spool; }
     }
     return { raw: c, ams: bestSpool };
  });
}

self.onmessage = async function(e) {
  const { action, payload } = e.data;

  if (action === 'GENERATE_PUZZLE') {
    try {
        if (!wasm) {
            wasm = await Module();
            wasm.setup();
        }

        const { colorStyle, zExaggeration, snowLinePct, treeLinePct, renderBathymetry, showWater, waterDrop, elevationData, imageData, landCoverMask, trailPoints, roadWays, bbox, imageWidth, imageHeight, puzzleRows, puzzleCols, pieceWidth, pieceDepth, tolerance } = payload;
        
        const baseThicknessMm = 5.0; 
        const t0 = performance.now();

        let activeSpools = TERRAIN_SPOOLS.slice(0, 1);
        let isSatellite = false;
        if (colorStyle.startsWith('kmeans-')) {
            isSatellite = true;
            const k = parseInt(colorStyle.split('-')[1]);
            activeSpools = TERRAIN_SPOOLS.slice(0, k);
            extractKMeansPalette(imageData, k);
        }

        const totalW = puzzleCols * pieceWidth;
        const totalD = puzzleRows * pieceDepth;
        const mX0 = -totalW / 2;
        const mY0 = totalD / 2;

        const earthRadius = 6371000;
        const latMid = (bbox.north + bbox.south) / 2 * Math.PI / 180;
        const realWidthMeters = (bbox.east - bbox.west) * Math.PI / 180 * Math.cos(latMid) * earthRadius;
        const trueScaleMmPerMeter = totalW / realWidthMeters;
        const zScale = trueScaleMmPerMeter * zExaggeration;

        const resCols = Math.min(450, Math.max(20, Math.round(totalW / 0.5))); 
        const resRows = Math.min(450, Math.max(20, Math.round(totalD / 0.5)));

        let effectiveMin = Infinity;
        let effectiveMax = -Infinity;
        for (let r = 0; r <= resRows; r++) {
            const v = r / resRows;
            for (let c = 0; c <= resCols; c++) {
                const u = c / resCols;
                const fRow = v * (elevationData.rows - 1);
                const fCol = u * (elevationData.cols - 1);
                let elev = sampleElev(elevationData, fRow, fCol);
                if (!renderBathymetry && elev < 0) elev = 0; 
                if (elev < effectiveMin) effectiveMin = elev;
                if (elev > effectiveMax) effectiveMax = elev;
            }
        }

        const vectorRes = 2048;
        const trailCanvas = new OffscreenCanvas(vectorRes, vectorRes);
        const ctx = trailCanvas.getContext('2d', { willReadFrequently: true });
        let trailMap: Uint8ClampedArray | null = null;
        let roadMap: Uint8ClampedArray | null = null;

        if (ctx && trailPoints && trailPoints.length > 0) {
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, vectorRes, vectorRes);
            
            const pixelWidth = Math.max(2, (1.68 / totalW) * vectorRes);
            ctx.strokeStyle = 'white';
            ctx.lineWidth = pixelWidth;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            
            ctx.beginPath();
            let isFirst = true;
            let lastX = -1, lastY = -1;
            
            for (const p of trailPoints) {
                const u = (p.lng - bbox.west) / (bbox.east - bbox.west);
                const v = (bbox.north - p.lat) / (bbox.north - bbox.south);
                const x = u * vectorRes;
                const y = v * vectorRes;
                
                if (isFirst) { ctx.moveTo(x, y); isFirst = false; } 
                else { 
                    if (Math.hypot(x - lastX, y - lastY) > (vectorRes * 0.25)) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y); 
                }
                lastX = x;
                lastY = y;
            }
            ctx.stroke();
            trailMap = ctx.getImageData(0, 0, vectorRes, vectorRes).data;
        }

        if (ctx && roadWays && roadWays.length > 0) {
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, vectorRes, vectorRes);
            
            const roadPixelWidth = Math.max(1.5, (1.2 / totalW) * vectorRes); 
            ctx.strokeStyle = 'white';
            ctx.lineWidth = roadPixelWidth;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            
            for (const way of roadWays) {
                ctx.beginPath();
                let isFirst = true;
                for (const p of way) {
                    const u = (p.lng - bbox.west) / (bbox.east - bbox.west);
                    const v = (bbox.north - p.lat) / (bbox.north - bbox.south);
                    const x = u * vectorRes;
                    const y = v * vectorRes;
                    if (isFirst) { ctx.moveTo(x, y); isFirst = false; } 
                    else { ctx.lineTo(x, y); }
                }
                ctx.stroke();
            }
            roadMap = ctx.getImageData(0, 0, vectorRes, vectorRes).data;
        }

        const pos: number[] = [];
        const idx: number[] = [];
        let vIdx = 0;
        const topGrid: number[][] = [], botGrid: number[][] = [];
        const MAX_SAFE_Z = 280.0;

        for (let r = 0; r <= resRows; r++) {
            const v = r / resRows;
            topGrid[r] = []; botGrid[r] = [];
            for (let c = 0; c <= resCols; c++) {
                const u = c / resCols;
                const bx = mX0 + u * totalW;
                const by = mY0 - v * totalD;
                
                const fRow = v * (elevationData.rows - 1);
                const fCol = u * (elevationData.cols - 1);
                let elev = sampleElev(elevationData, fRow, fCol);
                const isBelowSeaLevel = elev < 0; 
                if (!renderBathymetry && elev < 0) elev = 0;

                let bz = baseThicknessMm + ((elev - effectiveMin) * zScale);

                const pixelX = Math.floor(Math.max(0, Math.min(1, u)) * (imageWidth - 1));
                const pixelY = Math.floor(Math.max(0, Math.min(1, v)) * (imageHeight - 1));
                const flatIndex = (pixelY * imageWidth) + pixelX;
                const landCoverClass = landCoverMask[flatIndex];

                let pxHsl = {h: 0, s: 0, l: 0};
                let isVisuallyWater = false;

                if (colorStyle !== 'solid' && colorStyle !== 'elevation') {
                    let sumR = 0, sumG = 0, sumB = 0, count = 0;
                    const blurRadius = 3; 
                    for (let dy = -blurRadius; dy <= blurRadius; dy++) {
                        for (let dx = -blurRadius; dx <= blurRadius; dx++) {
                            const nx = Math.max(0, Math.min(imageWidth - 1, pixelX + dx));
                            const ny = Math.max(0, Math.min(imageHeight - 1, pixelY + dy));
                            const nIdx = (ny * imageWidth + nx) * 4;
                            sumR += imageData[nIdx];
                            sumG += imageData[nIdx+1];
                            sumB += imageData[nIdx+2];
                            count++;
                        }
                    }
                    const avgR = sumR / count, avgG = sumG / count, avgB = sumB / count;
                    pxHsl = rgbToHsl(avgR, avgG, avgB);
                    isVisuallyWater = (pxHsl.h > 0.45 && pxHsl.h < 0.75 && pxHsl.s > 0.12 && pxHsl.l < 0.85);
                }

                const isCopernicusWater = (landCoverClass === 1 || landCoverClass === 80 || landCoverClass === 90 || landCoverClass === 200);
                const isWater = isCopernicusWater || isBelowSeaLevel || isVisuallyWater;

                if (showWater && colorStyle !== 'solid' && isWater) bz -= waterDrop;

                if (roadMap) {
                    const pxX = Math.max(0, Math.min(vectorRes - 1, Math.floor(u * vectorRes)));
                    const pxY = Math.max(0, Math.min(vectorRes - 1, Math.floor(v * vectorRes)));
                    if (roadMap[(pxY * vectorRes + pxX) * 4] > 128) bz += 0.6; // Elevate roads slightly
                }

                if (trailMap) {
                    const pxX = Math.max(0, Math.min(vectorRes - 1, Math.floor(u * vectorRes)));
                    const pxY = Math.max(0, Math.min(vectorRes - 1, Math.floor(v * vectorRes)));
                    if (trailMap[(pxY * vectorRes + pxX) * 4] > 128) bz += 0.8; // Elevate trails above roads
                }

                bz = Math.min(bz, MAX_SAFE_Z);
                pos.push(bx, by, bz); topGrid[r][c] = vIdx++;
                pos.push(bx, by, 0); botGrid[r][c] = vIdx++;
            }
        }

        for (let r = 0; r < resRows; r++) {
            for (let c = 0; c < resCols; c++) {
                idx.push(topGrid[r][c], topGrid[r+1][c], topGrid[r][c+1]);
                idx.push(topGrid[r][c+1], topGrid[r+1][c], topGrid[r+1][c+1]);
                idx.push(botGrid[r][c], botGrid[r][c+1], botGrid[r+1][c]);
                idx.push(botGrid[r][c+1], botGrid[r+1][c+1], botGrid[r+1][c]);
            }
        }

        for (let c = 0; c < resCols; c++) {
            idx.push(topGrid[0][c], topGrid[0][c+1], botGrid[0][c]);
            idx.push(topGrid[0][c+1], botGrid[0][c+1], botGrid[0][c]);
            idx.push(topGrid[resRows][c], botGrid[resRows][c], topGrid[resRows][c+1]);
            idx.push(topGrid[resRows][c+1], botGrid[resRows][c], botGrid[resRows][c+1]);
        }
        for (let r = 0; r < resRows; r++) {
            idx.push(topGrid[r][0], botGrid[r][0], topGrid[r+1][0]);
            idx.push(topGrid[r+1][0], botGrid[r][0], botGrid[r+1][0]);
            idx.push(topGrid[r][resCols], topGrid[r+1][resCols], botGrid[r][resCols]);
            idx.push(topGrid[r+1][resCols], botGrid[r+1][resCols], botGrid[r][resCols]);
        }

        const mountainMesh = { vertProperties: new Float32Array(pos), triVerts: new Uint32Array(idx), numProp: 3 };
        const masterSolid = new wasm.Manifold(mountainMesh);
        const finalPieces = [];

        for (let r = 0; r < puzzleRows; r++) {
          for (let c = 0; c < puzzleCols; c++) {
             const x0 = mX0 + (c * pieceWidth), x1 = x0 + pieceWidth;
             const y0 = mY0 - (r * pieceDepth), y1 = y0 - pieceDepth;
             const nw = { x: x0, y: y0 }, ne = { x: x1, y: y0 };
             const sw = { x: x0, y: y1 }, se = { x: x1, y: y1 };

             const isNorthTab = ((r + c) % 2 === 0), isSouthTab = ((r + c) % 2 === 0);
             const isEastTab  = ((r + c) % 2 !== 0), isWestTab  = ((r + c) % 2 !== 0);

             let polygon = [];
             if (r === 0) polygon.push(nw); else polygon.push(...buildJigsawEdge(nw, ne, isNorthTab, tolerance));
             if (c === puzzleCols - 1) polygon.push(ne); else polygon.push(...buildJigsawEdge(ne, se, isEastTab, tolerance));
             if (r === puzzleRows - 1) polygon.push(se); else polygon.push(...buildJigsawEdge(se, sw, isSouthTab, tolerance));
             if (c === 0) polygon.push(sw); else polygon.push(...buildJigsawEdge(sw, nw, isWestTab, tolerance));

             const crossSection = new wasm.CrossSection([polygon.reverse()]);
             const cutterPrism = wasm.Manifold.extrude(crossSection, 300.0, 0, 0).translate([0, 0, -10]);

             const pieceSolid = masterSolid.intersect(cutterPrism);
             const resultMesh = pieceSolid.getMesh();
             
             const finalPos = resultMesh.vertProperties;
             const finalIdx = resultMesh.triVerts;
             const colors = new Float32Array(finalPos.length);

             const effectiveSnowLine = snowLinePct >= 1.0 ? 1.01 : snowLinePct;
             const elevRange = effectiveMax - effectiveMin;

             for (let i = 0; i < finalPos.length; i += 3) {
                const px = finalPos[i], py = finalPos[i+1], pz = finalPos[i+2];
                const u = (px - mX0) / totalW;
                const v = (mY0 - py) / totalD;
                const fCol = u * (elevationData.cols - 1);
                const fRow = v * (elevationData.rows - 1);
                
                let elev = sampleElev(elevationData, fRow, fCol);
                const isBelowSeaLevel = elev < 0; 
                if (!renderBathymetry && elev < 0) elev = 0;
                
                let originalSurfaceZ = baseThicknessMm + ((elev - effectiveMin) * zScale);
                let actualSurfaceZ = originalSurfaceZ;

                const pixelX = Math.floor(Math.max(0, Math.min(1, u)) * (imageWidth - 1));
                const pixelY = Math.floor(Math.max(0, Math.min(1, v)) * (imageHeight - 1));
                const flatIndex = (pixelY * imageWidth) + pixelX;
                const landCoverClass = landCoverMask[flatIndex];
                
                let pxHsl = {h: 0, s: 0, l: 0};
                let isVisuallyWater = false;

                if (colorStyle !== 'solid' && colorStyle !== 'elevation') {
                    let sumR = 0, sumG = 0, sumB = 0, count = 0;
                    const blurRadius = 3;
                    for (let dy = -blurRadius; dy <= blurRadius; dy++) {
                        for (let dx = -blurRadius; dx <= blurRadius; dx++) {
                            const nx = Math.max(0, Math.min(imageWidth - 1, pixelX + dx));
                            const ny = Math.max(0, Math.min(imageHeight - 1, pixelY + dy));
                            const nIdx = (ny * imageWidth + nx) * 4;
                            sumR += imageData[nIdx];
                            sumG += imageData[nIdx+1];
                            sumB += imageData[nIdx+2];
                            count++;
                        }
                    }
                    const avgR = sumR / count, avgG = sumG / count, avgB = sumB / count;
                    pxHsl = rgbToHsl(avgR, avgG, avgB);
                    isVisuallyWater = (pxHsl.h > 0.45 && pxHsl.h < 0.75 && pxHsl.s > 0.12 && pxHsl.l < 0.85);
                }
                
                const isCopernicusWater = (landCoverClass === 1 || landCoverClass === 80 || landCoverClass === 90 || landCoverClass === 200);
                const isWater = isCopernicusWater || isBelowSeaLevel || isVisuallyWater;
                
                const isTree = (landCoverClass === 10 || (landCoverClass >= 111 && landCoverClass <= 126));
                const isDirt = (landCoverClass === 20 || landCoverClass === 30 || landCoverClass === 40 || landCoverClass === 50 || landCoverClass === 60);
                const isSnow = (landCoverClass === 70);

                if (showWater && colorStyle !== 'solid' && isWater) actualSurfaceZ -= waterDrop;

                let onRoad = false;
                if (roadMap) {
                    const pxX = Math.max(0, Math.min(vectorRes - 1, Math.floor(u * vectorRes)));
                    const pxY = Math.max(0, Math.min(vectorRes - 1, Math.floor(v * vectorRes)));
                    if (roadMap[(pxY * vectorRes + pxX) * 4] > 128) {
                        onRoad = true;
                        actualSurfaceZ += 0.6;
                    }
                }

                let onTrail = false;
                if (trailMap) {
                    const pxX = Math.max(0, Math.min(vectorRes - 1, Math.floor(u * vectorRes)));
                    const pxY = Math.max(0, Math.min(vectorRes - 1, Math.floor(v * vectorRes)));
                    if (trailMap[(pxY * vectorRes + pxX) * 4] > 128) {
                        onTrail = true;
                        actualSurfaceZ += 0.8;
                    }
                }
                
                actualSurfaceZ = Math.min(actualSurfaceZ, MAX_SAFE_Z);
                const isPuzzleEdge = (u < 0.005 || u > 0.995 || v < 0.005 || v > 0.995);
                
                if (isPuzzleEdge || pz < actualSurfaceZ - 1.5) {
                    colors[i] = colorBase.r/255; colors[i+1] = colorBase.g/255; colors[i+2] = colorBase.b/255;
                    continue; 
                }
                
                if (onTrail) {
                    colors[i] = colorTrail.r/255; colors[i+1] = colorTrail.g/255; colors[i+2] = colorTrail.b/255;
                    continue;
                }

                if (onRoad) {
                    colors[i] = colorRoad.r/255; colors[i+1] = colorRoad.g/255; colors[i+2] = colorRoad.b/255;
                    continue;
                }

                if (showWater && colorStyle !== 'solid' && isWater) { 
                    colors[i] = colorWater.r/255; colors[i+1] = colorWater.g/255; colors[i+2] = colorWater.b/255;
                    continue;
                } 
                
                if (colorStyle === 'solid') {
                    colors[i] = colorBase.r/255; colors[i+1] = colorBase.g/255; colors[i+2] = colorBase.b/255;
                } 
                else if (colorStyle === 'elevation') {
                    const relativeZ = elevRange > 0 ? (elev - effectiveMin) / elevRange : 0;
                    let targetColor = colorBase; 
                    if (relativeZ > effectiveSnowLine) targetColor = TERRAIN_SPOOLS[2]; 
                    else if (relativeZ > treeLinePct) targetColor = TERRAIN_SPOOLS[1]; 
                    colors[i] = targetColor.r/255; colors[i+1] = targetColor.g/255; colors[i+2] = targetColor.b/255;
                }
                else if (isSatellite) {
                    let minDist = Infinity;
                    let bestColor = activeSpools[0]; 

                    for (const spool of activeSpools) {
                        const spoolHsl = rgbToHsl(spool.r, spool.g, spool.b);
                        let dHue = Math.abs(pxHsl.h - spoolHsl.h);
                        if (dHue > 0.5) dHue = 1 - dHue;
                        let dSat = Math.abs(pxHsl.s - spoolHsl.s);
                        let dLight = Math.abs(pxHsl.l - spoolHsl.l);
                        let dist = (dHue * 4.0)**2 + (dSat * 1.5)**2 + (dLight * 0.2)**2; 
                        if (dist < minDist) { 
                            minDist = dist; 
                            bestColor = spool; 
                        }
                    }

                    if (isTree) {
                        if (activeSpools.includes(TERRAIN_SPOOLS[1])) bestColor = TERRAIN_SPOOLS[1];
                    } else if (isDirt) {
                        if (activeSpools.includes(TERRAIN_SPOOLS[0])) bestColor = TERRAIN_SPOOLS[0];
                    } else if (isSnow) {
                        if (activeSpools.includes(TERRAIN_SPOOLS[2])) bestColor = TERRAIN_SPOOLS[2];
                    }

                    colors[i] = bestColor.r/255; colors[i+1] = bestColor.g/255; colors[i+2] = bestColor.b/255;
                } 
             }

             finalPieces.push({ row: r, col: c, positions: finalPos, indices: finalIdx, colors: colors });
             cutterPrism.delete();
             pieceSolid.delete();
          }
        }

        masterSolid.delete();
        const dt = (performance.now() - t0).toFixed(2);
        console.log(`[Worker] Sliced Jigsaw terrain in ${dt}ms`);
        self.postMessage({ status: 'SUCCESS', pieces: finalPieces });

    } catch (err: any) {
        self.postMessage({ status: 'ERROR', error: err.message || String(err) });
    }
  }
};