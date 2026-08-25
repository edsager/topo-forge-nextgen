// src/main.ts
import { projectState } from './state/projectState';
import { MapContainer } from './components/MapContainer';
import { fetchGlobalElevation, fetchSatelliteImage, fetchLandCoverData, geocodeLocation } from './core/api';
import { ThreeViewManager } from './core/ThreeViewManager';
import type { MeshPieceData } from './core/ThreeViewManager';
import { exportToBambuOBJ } from './core/exporter';

// Informs TypeScript that Leaflet is loaded globally in index.html
declare const L: any;

const mapUI = new MapContainer('map-view');
const threeView = new ThreeViewManager('three-view');
const meshWorker = new Worker(new URL('./workers/mesh.worker.ts', import.meta.url), { type: 'module' });

const searchInput = document.getElementById('search-input') as HTMLInputElement;
const searchBtn = document.getElementById('search-btn') as HTMLButtonElement;
const generateBtn = document.getElementById('generate-btn') as HTMLButtonElement;
const exportBtn = document.getElementById('export-btn') as HTMLButtonElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;

const colorStyleSelect = document.getElementById('color-style-select') as HTMLSelectElement;
const zExaggerationInput = document.getElementById('z-exaggeration') as HTMLInputElement;
const zValText = document.getElementById('z-val') as HTMLSpanElement;
const mapLayerSelect = document.getElementById('map-layer-select') as HTMLSelectElement;

// Map Size & Grid Hooks
const totalWidthInput = document.getElementById('total-width-mm') as HTMLInputElement;
const gridColsInput = document.getElementById('grid-cols') as HTMLInputElement;
const gridRowsInput = document.getElementById('grid-rows') as HTMLInputElement;
const nozzleSizeSelect = document.getElementById('nozzle-size') as HTMLSelectElement;
const layerHeightVal = document.getElementById('layer-height-val') as HTMLSpanElement;
const waterDropLayersSelect = document.getElementById('water-drop-layers') as HTMLSelectElement;

let currentLayerHeight = 0.20;

function updateLayerHeight() {
    const nozzle = parseFloat(nozzleSizeSelect.value);
    currentLayerHeight = nozzle / 2;
    if (layerHeightVal) {
      layerHeightVal.innerText = currentLayerHeight.toFixed(2);
    }
}

if (nozzleSizeSelect) {
  nozzleSizeSelect.addEventListener('change', updateLayerHeight);
  updateLayerHeight();
}

if (zExaggerationInput && zValText) {
  zExaggerationInput.addEventListener('input', (event) => { 
    zValText.innerText = `${(event.target as HTMLInputElement).value}x`; 
  });
}

let currentTileLayer: any = null;
if (mapLayerSelect) {
  mapLayerSelect.addEventListener('change', () => {
      const leafletMap = (mapUI as any).map || (mapUI as any).leafletMap || (mapUI as any)._map;
      if (!leafletMap) return;
      if (currentTileLayer) leafletMap.removeLayer(currentTileLayer);
      
      if (mapLayerSelect.value === 'satellite') {
          currentTileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(leafletMap);
      } else {
          currentTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(leafletMap);
      }
  });
  setTimeout(() => mapLayerSelect.dispatchEvent(new Event('change')), 500);
}

// Stacked Column Logic
const stackedWrapper = document.getElementById('stacked-column-wrapper') as HTMLDivElement;
const col = document.getElementById('stacked-col') as HTMLDivElement;
const segSnow = document.getElementById('seg-snow') as HTMLDivElement;
const segTree = document.getElementById('seg-tree') as HTMLDivElement;
const segEarth = document.getElementById('seg-earth') as HTMLDivElement;
const txtSnow = document.getElementById('txt-snow') as HTMLSpanElement;
const txtTree = document.getElementById('txt-tree') as HTMLSpanElement;
const txtEarth = document.getElementById('txt-earth') as HTMLSpanElement;

let snowPct = 20, treePct = 30, earthPct = 50;

function updateStackedUI() {
    if (!segSnow || !segTree || !segEarth) return;
    segSnow.style.height = `${snowPct}%`;
    segTree.style.height = `${treePct}%`;
    segEarth.style.height = `${earthPct}%`;
    if (txtSnow) txtSnow.innerText = snowPct > 5 ? `${snowPct}%` : '';
    if (txtTree) txtTree.innerText = treePct > 5 ? `${treePct}%` : '';
    if (txtEarth) txtEarth.innerText = earthPct > 5 ? `${earthPct}%` : '';
}

let draggingObj: 'snow' | 'tree' | null = null;
document.getElementById('handle-snow')?.addEventListener('mousedown', () => draggingObj = 'snow');
document.getElementById('handle-tree')?.addEventListener('mousedown', () => draggingObj = 'tree');

document.addEventListener('mousemove', (e) => {
    if (!draggingObj || !col) return;
    const rect = col.getBoundingClientRect();
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    const totalPct = (y / rect.height) * 100;

    if (draggingObj === 'snow') {
        snowPct = Math.round(totalPct);
        if (snowPct > 100 - earthPct) snowPct = 100 - earthPct; 
        treePct = 100 - snowPct - earthPct;
    } else if (draggingObj === 'tree') {
        const topOfTree = snowPct;
        const bottomOfTree = Math.round(totalPct);
        if (bottomOfTree > topOfTree) {
            treePct = bottomOfTree - snowPct;
            earthPct = 100 - snowPct - treePct;
        }
    }
    updateStackedUI();
});
document.addEventListener('mouseup', () => draggingObj = null);

if (colorStyleSelect && stackedWrapper) {
  colorStyleSelect.addEventListener('change', (e) => {
      stackedWrapper.style.display = (e.target as HTMLSelectElement).value === 'elevation' ? 'flex' : 'none';
  });
}

const toggleBathymetry = document.getElementById('toggle-bathymetry') as HTMLInputElement;

const gpxInput = document.createElement('input');
gpxInput.type = 'file';
gpxInput.accept = '.gpx';
gpxInput.multiple = true; 
gpxInput.style.display = 'none';
document.body.appendChild(gpxInput);

const loadGpxBtn = document.getElementById('load-gpx-btn') as HTMLButtonElement;
const gpxStatus = document.getElementById('gpx-status') as HTMLSpanElement;

// Clear GPX Button
const clearGpxBtn = document.createElement('button');
clearGpxBtn.innerText = 'Clear';
clearGpxBtn.style.display = 'none';
clearGpxBtn.style.marginLeft = '5px';
clearGpxBtn.style.backgroundColor = '#cc0000';
loadGpxBtn?.parentNode?.insertBefore(clearGpxBtn, loadGpxBtn.nextSibling);

let loadedTrailPoints: { lat: number; lng: number }[] = [];
let finishedPuzzlePieces: MeshPieceData[] = []; 

const performSearch = async () => {
  if (!searchInput) return;
  const query = searchInput.value.trim();
  if (!query) return;
  try {
    if (searchBtn) {
      searchBtn.innerText = '...';
      searchBtn.disabled = true;
    }
    if (statusText) statusText.innerText = `Searching...`;
    const result = await geocodeLocation(query);
    const leafletEngine = (mapUI as any).map || (mapUI as any).leafletMap || (mapUI as any)._map;
    if (leafletEngine && typeof leafletEngine.flyTo === 'function') {
      leafletEngine.flyTo([result.lat, result.lon], 11, { duration: 2.0 });
    }
    if (statusText) statusText.innerText = `Flew to: ${result.displayName}.`;
  } catch (error: any) {
    if (statusText) statusText.innerText = error.message;
  } finally {
    if (searchBtn) {
      searchBtn.innerText = 'Find';
      searchBtn.disabled = false;
    }
  }
};

searchBtn?.addEventListener('click', performSearch);
searchInput?.addEventListener('keypress', (e) => { if (e.key === 'Enter') performSearch(); });
loadGpxBtn?.addEventListener('click', () => gpxInput.click());

// Load GPX event
gpxInput.addEventListener('change', async (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (!files || files.length === 0) return;
  loadedTrailPoints = [];
  for (let f = 0; f < files.length; f++) {
      const text = await files[f].text();
      const parser = new DOMParser();
      const xml = parser.parseFromString(text, 'application/xml');
      const trackPoints = xml.getElementsByTagName('trkpt');
      for (let i = 0; i < trackPoints.length; i++) {
        const lat = parseFloat(trackPoints[i].getAttribute('lat') || '0');
        const lng = parseFloat(trackPoints[i].getAttribute('lon') || '0');
        if (lat && lng) loadedTrailPoints.push({ lat, lng });
      }
  }
  if (gpxStatus) {
    gpxStatus.style.display = 'inline';
    gpxStatus.innerText = `(${loadedTrailPoints.length} pts)`;
  }
  clearGpxBtn.style.display = 'inline-block';
});

// Clear GPX event
clearGpxBtn.addEventListener('click', () => {
    loadedTrailPoints = [];
    gpxInput.value = ''; 
    if (gpxStatus) gpxStatus.style.display = 'none';
    clearGpxBtn.style.display = 'none';
    if (statusText) statusText.innerText = "Trail cleared.";
});

projectState.onBboxChange = (bbox) => {
  if (bbox) {
    if (generateBtn) generateBtn.disabled = false;
    if (statusText) statusText.innerText = "Ready to generate.";
  } else {
    if (generateBtn) generateBtn.disabled = true;
    if (exportBtn) exportBtn.disabled = true; 
  }
};

meshWorker.onmessage = (e) => {
  const { status, pieces, error } = e.data;
  if (status === 'SUCCESS') {
    finishedPuzzlePieces = pieces; 
    threeView.renderMeshes(pieces);
    if (statusText) statusText.innerText = "Complete!";
    if (generateBtn) generateBtn.disabled = false;
    if (exportBtn) exportBtn.disabled = false; 
  } else if (status === 'ERROR') {
    if (statusText) statusText.innerText = `Error: ${error}`;
    if (generateBtn) generateBtn.disabled = false;
  }
};

exportBtn?.addEventListener('click', () => {
  if (finishedPuzzlePieces.length === 0) return;
  if (statusText) statusText.innerText = "Packaging OBJ...";
  exportBtn.disabled = true;
  setTimeout(() => {
    exportToBambuOBJ(finishedPuzzlePieces, `TopoForge_Puzzle.obj`);
    if (statusText) statusText.innerText = "Download complete!";
    exportBtn.disabled = false;
  }, 100);
});

generateBtn?.addEventListener('click', async () => {
  const bbox = projectState.bbox;
  if (!bbox) return;

  try {
    generateBtn.disabled = true;
    if (exportBtn) exportBtn.disabled = true;
    if (statusText) statusText.innerText = "Downloading...";

    const degreeAspect = (bbox.north - bbox.south) / (bbox.east - bbox.west);
    let elevCols = 150, elevRows = 150;
    let imgW = 1024, imgH = 1024;

    if (degreeAspect < 1) { 
      elevRows = Math.max(10, Math.floor(elevCols * degreeAspect));
      imgH = Math.max(10, Math.floor(imgW * degreeAspect));
    } else { 
      elevCols = Math.max(10, Math.floor(elevRows / degreeAspect));
      imgW = Math.max(10, Math.floor(imgH / degreeAspect));
    }
    
    const [elevData, imgData, landCoverMask] = await Promise.all([
      fetchGlobalElevation(bbox, elevRows, elevCols),
      fetchSatelliteImage(bbox, imgW, imgH),
      fetchLandCoverData(bbox, imgW, imgH)
    ]);

    if (statusText) statusText.innerText = `Slicing Grid...`;

    const latMid = (bbox.north + bbox.south) / 2;
    const cosLat = Math.cos(latMid * Math.PI / 180);
    const physicalAspect = Math.max(0.2, Math.min(5.0, degreeAspect / cosLat));
    
    const totalW = parseInt(totalWidthInput.value);
    const totalD = totalW * physicalAspect;
    const puzzleCols = parseInt(gridColsInput.value);
    const puzzleRows = parseInt(gridRowsInput.value);

    const pieceWidth = totalW / puzzleCols; 
    const pieceDepth = totalD / puzzleRows;

    const calculatedWaterDrop = parseInt(waterDropLayersSelect?.value || '1') * currentLayerHeight;

    meshWorker.postMessage({
      action: 'GENERATE_PUZZLE',
      payload: {
        colorStyle: colorStyleSelect.value, 
        zExaggeration: parseFloat(zExaggerationInput.value),
        snowLinePct: (100 - snowPct) / 100, 
        treeLinePct: earthPct / 100, 
        renderBathymetry: toggleBathymetry?.checked || false,
        showWater: true,
        waterDrop: calculatedWaterDrop,
        elevationData: elevData,
        imageData: imgData.data,       
        landCoverMask: landCoverMask,          
        trailPoints: loadedTrailPoints, 
        bbox: bbox,
        imageWidth: imgW,
        imageHeight: imgH,
        puzzleRows: puzzleRows,
        puzzleCols: puzzleCols,
        pieceWidth: pieceWidth, 
        pieceDepth: pieceDepth, 
        tolerance: 0.15 
      }
    });

  } catch (error: any) {
    if (statusText) statusText.innerText = `Failed: ${error.message}`;
    generateBtn.disabled = false;
  }
});