import { fromArrayBuffer } from 'geotiff';

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface ElevationData {
  grid: number[][];
  rows: number;
  cols: number;
  min: number;
  max: number;
  bounds: Bounds;
}

/**
 * NEW: AWS Terrarium Global Elevation Engine
 * Bypasses ESRI tokens by stitching and decoding open-source RGB terrain tiles
 */
export async function fetchGlobalElevation(
  bounds: Bounds,
  rows: number,
  cols: number
): Promise<ElevationData> {
  console.log(`[API] Fetching Global AWS Terrarium Elevation...`);

  // 1. Calculate the ideal tile zoom level based on bounding box size
  const lonDiff = bounds.east - bounds.west;
  const zoom = Math.min(14, Math.max(8, Math.round(Math.log2(1440 / lonDiff))));

  // 2. Convert Lat/Lon bounds to Spherical Mercator Tile X/Y coordinates
  const minX = Math.floor((bounds.west + 180) / 360 * Math.pow(2, zoom));
  const maxX = Math.floor((bounds.east + 180) / 360 * Math.pow(2, zoom));
  const lat2y = (lat: number) => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom);
  const minY = Math.floor(lat2y(bounds.north));
  const maxY = Math.floor(lat2y(bounds.south));

  const canvasWidth = (maxX - minX + 1) * 256;
  const canvasHeight = (maxY - minY + 1) * 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas context failed');

  // 3. Fetch and stitch all required PNG elevation tiles
  const loadTile = (x: number, y: number) => {
    return new Promise<void>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        ctx.drawImage(img, (x - minX) * 256, (y - minY) * 256);
        resolve();
      };
      img.onerror = () => {
        // Fill missing tiles with sea-level data: (128 * 256) - 32768 = 0
        ctx.fillStyle = 'rgb(128, 0, 0)';
        ctx.fillRect((x - minX) * 256, (y - minY) * 256, 256, 256);
        resolve();
      };
      // Accessing the open AWS S3 bucket for Mapzen Terrarium data
      img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${x}/${y}.png`;
    });
  };

  const promises = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      promises.push(loadTile(x, y));
    }
  }

  await Promise.all(promises);
  const imgData = ctx.getImageData(0, 0, canvasWidth, canvasHeight).data;

  // 4. Sample the stitched canvas and decrypt the RGB values into pure geometry
  const grid: number[][] = [];
  let minElev = Infinity;
  let maxElev = -Infinity;

  for (let r = 0; r < rows; r++) {
    const rowData: number[] = [];
    const lat = bounds.north - (r / (rows - 1)) * (bounds.north - bounds.south);
    const tyFloat = lat2y(lat);
    const py = Math.floor((tyFloat - minY) * 256);

    for (let c = 0; c < cols; c++) {
      const lon = bounds.west + (c / (cols - 1)) * (bounds.east - bounds.west);
      const txFloat = (lon + 180) / 360 * Math.pow(2, zoom);
      const px = Math.floor((txFloat - minX) * 256);

      const safePx = Math.max(0, Math.min(canvasWidth - 1, px));
      const safePy = Math.max(0, Math.min(canvasHeight - 1, py));
      const idx = (safePy * canvasWidth + safePx) * 4;

      const R = imgData[idx];
      const G = imgData[idx + 1];
      const B = imgData[idx + 2];

      // The Terrarium RGB mathematical decryption formula
      let elevation = (R * 256 + G + B / 256) - 32768;
      if (elevation < -11000) elevation = 0; // Filter ocean floor anomalies

      rowData.push(elevation);
      if (elevation < minElev) minElev = elevation;
      if (elevation > maxElev) maxElev = elevation;
    }
    grid.push(rowData);
  }

  return { grid, rows, cols, min: minElev, max: maxElev, bounds };
}

export async function fetchSatelliteImage(
  bounds: Bounds,
  width: number,
  height: number
): Promise<ImageData> {
  console.log(`[API] Fetching satellite imagery (${width}x${height})...`);
  
  const params = new URLSearchParams({
    bbox: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    bboxSR: '4326',
    size: `${width},${height}`,
    imageSR: '4326',
    format: 'png',
    f: 'image',
  });

  const url = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?${params}`;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return reject(new Error('Failed to create 2D canvas context'));
      
      ctx.drawImage(img, 0, 0, width, height);
      resolve(ctx.getImageData(0, 0, width, height));
    };

    img.onerror = () => reject(new Error('Failed to load satellite image'));
    img.src = url;
  });
}

// ESRI Land Cover is a public/free endpoint, so it remains safe to use
export async function fetchLandCoverData(
  bounds: Bounds,
  width: number,
  height: number
): Promise<Uint8Array> {
  console.log(`[API] Fetching ESRI 10m Land Cover classification...`);

  const params = new URLSearchParams({
    bbox: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    bboxSR: '4326',
    size: `${width},${height}`,
    imageSR: '4326',
    format: 'tiff',
    pixelType: 'U8',
    noDataInterpretation: 'esriNoDataMatchAny',
    interpolation: 'RSP_NearestNeighbor', 
    f: 'image',
  });

  const url = `https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer/exportImage?${params}`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`ESRI Land Cover HTTP Error: ${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength < 200) {
    const text = new TextDecoder().decode(arrayBuffer);
    if (text.includes('error') || text.startsWith('{')) {
      throw new Error(`ESRI Error: ${text.slice(0, 100)}`);
    }
  }

  const tiff = await fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();
  const rasters = await image.readRasters();
  
  return rasters[0] as Uint8Array; 
}

export async function geocodeLocation(query: string) {
  console.log(`[API] Geocoding location: ${query}`);
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
  
  const response = await fetch(url, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
  
  if (!response.ok) throw new Error('Geocoding service unavailable.');
  const data = await response.json();
  
  if (!data || data.length === 0) throw new Error(`Could not find location: "${query}"`);
  
  return {
    lat: parseFloat(data[0].lat),
    lon: parseFloat(data[0].lon),
    displayName: data[0].display_name
  };
}