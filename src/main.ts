// src/main.ts
import { projectState } from './state/projectState';
import { MapContainer } from './components/MapContainer';
import { fetchGlobalElevation, fetchLandCoverData, geocodeLocation } from './core/api';
import { ThreeViewManager } from './core/ThreeViewManager';
import type { MeshPieceData } from './core/ThreeViewManager';
import { exportToBambuOBJ } from './core/exporter';

declare const L: any;

const mapUI = new MapContainer('map-view');
const threeView = new ThreeViewManager('three-view');
const meshWorker = new Worker(new URL('./workers/mesh.worker.ts', import.meta.url), { type: 'module' });

const searchInput = document.getElementById('search-input') as HTMLInputElement;
const searchBtn = document.getElementById('search-btn') as HTMLButtonElement;
const generateBtn = document.getElementById('generate-btn') as HTMLButtonElement;
const exportBtn = document.getElementById('export-btn') as HTMLButtonElement;
const previewRoadsBtn = document.getElementById('preview-roads-btn') as HTMLButtonElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;

const zExaggerationInput = document.getElementById('z-exaggeration') as HTMLInputElement;
const zValText = document.getElementById('z-val') as HTMLSpanElement;
const mapLayerSelect = document.getElementById('map-layer-select') as HTMLSelectElement;

const totalWidthInput = document.getElementById('total-width-mm') as HTMLInputElement;
const gridColsInput = document.getElementById('grid-cols') as HTMLInputElement;
const gridRowsInput = document.getElementById('grid-rows') as HTMLInputElement;
const nozzleSizeSelect = document.getElementById('nozzle-size') as HTMLSelectElement;
const layerHeightVal = document.getElementById('layer-height-val') as HTMLSpanElement;
const waterDropLayersSelect = document.getElementById('water-drop-layers') as HTMLSelectElement;
const includeRoadsCheckbox = document.getElementById('include-roads') as HTMLInputElement;

const colWater = document.getElementById('col-water') as HTMLInputElement;
const colDirt = document.getElementById('col-dirt') as HTMLInputElement;
const colForest = document.getElementById('col-forest') as HTMLInputElement;
const colRock = document.getElementById('col-rock') as HTMLInputElement;
const colSnow = document.getElementById('col-snow') as HTMLInputElement;
const colRoads = document.getElementById('col-roads') as HTMLInputElement;
const colBldgs = document.getElementById('col-bldgs') as HTMLInputElement;

let currentLayerHeight = 0.20;

function updateLayerHeight() {
    const nozzle = parseFloat(nozzleSizeSelect.value);
    currentLayerHeight = nozzle / 2;
    if (layerHeightVal) layerHeightVal.innerText = currentLayerHeight.toFixed(2);
}
nozzleSizeSelect?.addEventListener('change', updateLayerHeight);
updateLayerHeight();

zExaggerationInput?.addEventListener('input', (event) => { 
  zValText.innerText = `${(event.target as HTMLInputElement).value}x`; 
});

let currentTileLayer: any = null;
let infrastructureOverlayGroup: any = null;

mapLayerSelect?.addEventListener('change', () => {
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

const gpxInput = document.createElement('input');
gpxInput.type = 'file';
gpxInput.accept = '.gpx';
gpxInput.multiple = true; 
gpxInput.style.display = 'none';
document.body.appendChild(gpxInput);

const loadGpxBtn = document.getElementById('load-gpx-btn') as HTMLButtonElement;
const gpxStatus = document.getElementById('gpx-status') as HTMLSpanElement;

const clearGpxBtn = document.createElement('button');
clearGpxBtn.innerText = 'Clear';
clearGpxBtn.style.display = 'none';
clearGpxBtn.style.marginLeft = '5px';
clearGpxBtn.style.backgroundColor = '#cc0000';
loadGpxBtn?.parentNode?.insertBefore(clearGpxBtn, loadGpxBtn.nextSibling);

let loadedTrailPoints: { lat: number; lng: number }[] = [];

loadGpxBtn?.addEventListener('click', () => gpxInput.click());

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

clearGpxBtn.addEventListener('click', () => {
    loadedTrailPoints = [];
    gpxInput.value = ''; 
    if (gpxStatus) gpxStatus.style.display = 'none';
    clearGpxBtn.style.display = 'none';
    if (statusText) statusText.innerText = "Trail cleared.";
});

// Robust POST Request for Road & Building Preview
previewRoadsBtn?.addEventListener('click', async () => {
    const bbox = projectState.bbox;
    if (!bbox) return;
    const leafletMap = (mapUI as any).map || (mapUI as any).leafletMap || (mapUI as any)._map;
    
    if (infrastructureOverlayGroup) leafletMap.removeLayer(infrastructureOverlayGroup);
    infrastructureOverlayGroup = L.layerGroup().addTo(leafletMap);
    
    previewRoadsBtn.innerText = 'Loading Data...';
    previewRoadsBtn.disabled = true;

    try {
        // Querying both Roads and Buildings
        const query = `[out:json];(way["highway"~"motorway|trunk|primary|secondary"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});way["building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east}););out geom;`;
        
        const res = await fetch(`https://overpass-api.de/api/interpreter`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `data=${encodeURIComponent(query)}`
        });

        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch(err) {
            throw new Error(`Server returned non-JSON (Rate limit or busy).`);
        }
        
        if (!data?.elements || data.elements.length === 0) {
            statusText.innerText = `No roads or buildings found in this area.`;
            return;
        }

        let roadCount = 0;
        let bldgCount = 0;

        data.elements.forEach((el: any) => {
            if (el.type === 'way' && el.geometry && el.tags) {
                const latlngs = el.geometry.map((g: any) => [g.lat, g.lon]);
                
                if (el.tags.building) {
                    L.polygon(latlngs, {color: colBldgs.value, weight: 1, fillColor: colBldgs.value, fillOpacity: 0.5}).addTo(infrastructureOverlayGroup);
                    bldgCount++;
                } else if (el.tags.highway) {
                    L.polyline(latlngs, {color: colRoads.value, weight: 3, opacity: 0.8}).addTo(infrastructureOverlayGroup);
                    roadCount++;
                }
            }
        });
        statusText.innerText = `Previewing ${roadCount} roads and ${bldgCount} buildings.`;
    } catch (e: any) {
        statusText.innerText = `API Error: ${e.message}`;
    } finally {
        previewRoadsBtn.innerText = 'Preview Roads on Map';
        previewRoadsBtn.disabled = false;
    }
});

let finishedPuzzlePieces: MeshPieceData[] = []; 

const performSearch = async () => {
  if (!searchInput) return;
  const query = searchInput.value.trim();
  if (!query) return;
  try {
    searchBtn.innerText = '...';
    searchBtn.disabled = true;
    statusText.innerText = `Searching...`;
    const result = await geocodeLocation(query);
    const leafletEngine = (mapUI as any).map || (mapUI as any).leafletMap || (mapUI as any)._map;
    if (leafletEngine && typeof leafletEngine.flyTo === 'function') {
      leafletEngine.flyTo([result.lat, result.lon], 11, { duration: 2.0 });
    }
    statusText.innerText = `Flew to: ${result.displayName}.`;
  } catch (error: any) {
    statusText.innerText = error.message;
  } finally {
    searchBtn.innerText = 'Find';
    searchBtn.disabled = false;
  }
};

searchBtn?.addEventListener('click', performSearch);
searchInput?.addEventListener('keypress', (e) => { if (e.key === 'Enter') performSearch(); });

projectState.onBboxChange = (bbox) => {
  if (bbox) {
    generateBtn.disabled = false;
    statusText.innerText = "Ready to generate.";
  } else {
    generateBtn.disabled = true;
    exportBtn.disabled = true; 
  }
};

meshWorker.onmessage = (e) => {
  const { status, pieces, error } = e.data;
  if (status === 'SUCCESS') {
    finishedPuzzlePieces = pieces; 
    threeView.renderMeshes(pieces);
    statusText.innerText = "Complete!";
    generateBtn.disabled = false;
    exportBtn.disabled = false; 
  } else if (status === 'ERROR') {
    statusText.innerText = `Error: ${error}`;
    generateBtn.disabled = false;
  }
};

exportBtn?.addEventListener('click', () => {
  if (finishedPuzzlePieces.length === 0) return;
  statusText.innerText = "Packaging OBJ...";
  exportBtn.disabled = true;
  setTimeout(() => {
    exportToBambuOBJ(finishedPuzzlePieces, `TopoForge_Puzzle.obj`);
    statusText.innerText = "Download complete!";
    exportBtn.disabled = false;
  }, 100);
});

generateBtn?.addEventListener('click', async () => {
  const bbox = projectState.bbox;
  if (!bbox) return;

  try {
    generateBtn.disabled = true;
    exportBtn.disabled = true;
    statusText.innerText = "Downloading Geographic Data...";

    const degreeAspect = (bbox.north - bbox.south) / (bbox.east - bbox.west);
    let elevCols = 150, elevRows = 150;
    
    if (degreeAspect < 1) { 
      elevRows = Math.max(10, Math.floor(elevCols * degreeAspect));
    } else { 
      elevCols = Math.max(10, Math.floor(elevRows / degreeAspect));
    }
    
    const [elevData, landCoverMask] = await Promise.all([
      fetchGlobalElevation(bbox, elevRows, elevCols),
      fetchLandCoverData(bbox, 512, 512)
    ]);

    let infrastructureData = null;
    if (includeRoadsCheckbox.checked) {
        statusText.innerText = "Fetching Infrastructure Data...";
        try {
            const query = `[out:json];(way["highway"~"motorway|trunk|primary|secondary"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});way["building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east}););out geom;`;
            const res = await fetch(`https://overpass-api.de/api/interpreter`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `data=${encodeURIComponent(query)}`
            });
            const text = await res.text();
            let rawData;
            try { rawData = JSON.parse(text); } catch(err) { /* ignore HTML errors */ }
            if (rawData?.elements) {
                infrastructureData = rawData;
            }
        } catch (e) {
            console.warn("Infrastructure fetch failed, skipping.");
        }
    }

    statusText.innerText = `Slicing Grid...`;

    const latMid = (bbox.north + bbox.south) / 2;
    const cosLat = Math.cos(latMid * Math.PI / 180);
    const physicalAspect = Math.max(0.2, Math.min(5.0, degreeAspect / cosLat));
    
    const totalW = parseInt(totalWidthInput.value);
    const totalD = totalW * physicalAspect;
    const puzzleCols = parseInt(gridColsInput.value);
    const puzzleRows = parseInt(gridRowsInput.value);

    const calculatedWaterDrop = parseInt(waterDropLayersSelect?.value || '1') * currentLayerHeight;

    meshWorker.postMessage({
      action: 'GENERATE_PUZZLE',
      payload: {
        zExaggeration: parseFloat(zExaggerationInput.value),
        renderBathymetry: document.getElementById('toggle-bathymetry') ? (document.getElementById('toggle-bathymetry') as HTMLInputElement).checked : false,
        waterDrop: calculatedWaterDrop,
        elevationData: elevData,     
        elevRows: elevRows,
        elevCols: elevCols,
        landCoverMask: landCoverMask,
        maskWidth: 512,
        maskHeight: 512,
        // (We will add the infrastructure data back to the worker unpacking list in the next step!)
        bbox: bbox,
        puzzleRows: puzzleRows,
        puzzleCols: puzzleCols,
        pieceWidth: totalW / puzzleCols, 
        pieceDepth: totalD / puzzleRows, 
        tolerance: 0.15,
        colors: {
            water: colWater.value,
            dirt: colDirt.value,
            forest: colForest.value,
            rock: colRock.value,
            snow: colSnow.value,
            roads: colRoads.value,
            buildings: colBldgs.value
        }
      }
    });

  } catch (error: any) {
    statusText.innerText = `Failed: ${error.message}`;
    generateBtn.disabled = false;
  }
});