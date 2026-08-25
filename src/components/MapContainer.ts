import * as L from 'leaflet';
import { projectState } from '../state/projectState';
import type { BoundingBox } from '../state/projectState';

export class MapContainer {
  private map: L.Map;
  private rectLayer: L.Rectangle | null = null;
  private handles: L.Marker[] = [];
  private dragStart: L.LatLng | null = null;
  private tempRect: L.Rectangle | null = null;
  
  private handleIcon = L.divIcon({
    className: 'custom-map-handle',
    html: `<div style="width: 12px; height: 12px; background: #007acc; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 4px rgba(0,0,0,0.5); transform: translate(-6px, -6px);"></div>`,
    iconSize: [0, 0]
  });

  constructor(containerId: string) {
    this.map = L.map(containerId, { worldCopyJump: true }).setView([40.4, -111.65], 9);
    
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(this.map);

    // Start with an empty map and wait for the user to draw
    this.setupDrawBehavior();
  }

  private setupDrawBehavior() {
    const container = this.map.getContainer();
    
    // 1. Start drawing a new box
    container.addEventListener('mousedown', (e: MouseEvent) => {
      if (!e.shiftKey) return;
      e.preventDefault();
      this.map.dragging.disable();
      
      // Instantly wipe the old box and handles the moment a new draw starts
      this.clearBox();
      
      this.dragStart = this.map.mouseEventToLatLng(e);
    });

    // 2. Update the temporary dashed box while dragging
    container.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.dragStart) return;
      const pt = this.map.mouseEventToLatLng(e);
      const bounds = L.latLngBounds(this.dragStart, pt);
      
      if (this.tempRect) {
        this.tempRect.setBounds(bounds);
      } else {
        this.tempRect = L.rectangle(bounds, { 
          color: '#8b3a14', weight: 2, fillOpacity: 0.05, dashArray: '5,4', interactive: false 
        }).addTo(this.map);
      }
    });

    // 3. Finish drawing and spawn the interactive handles
    window.addEventListener('mouseup', (e: MouseEvent) => {
      if (!this.dragStart) return;
      const pt = this.map.mouseEventToLatLng(e);
      
      const bounds: BoundingBox = {
        north: Math.max(this.dragStart.lat, pt.lat),
        south: Math.min(this.dragStart.lat, pt.lat),
        east: Math.max(this.dragStart.lng, pt.lng),
        west: Math.min(this.dragStart.lng, pt.lng)
      };

      if (this.tempRect) {
        this.tempRect.remove();
        this.tempRect = null;
      }

      this.dragStart = null;
      this.map.dragging.enable();

      // Only convert to a permanent box if it's an actual rectangle (not a click)
      if (Math.abs(bounds.north - bounds.south) > 1e-4) {
        this.drawBoxAndHandles(bounds);
      }
    });
  }

  private clearBox() {
    if (this.rectLayer) {
      this.rectLayer.remove();
      this.rectLayer = null;
    }
    this.handles.forEach(h => h.remove());
    this.handles = [];
    projectState.bbox = null;
    projectState.onBboxChange(null);
  }

  private drawBoxAndHandles(bounds: BoundingBox) {
    this.clearBox();

    this.rectLayer = L.rectangle([
      [bounds.south, bounds.west],
      [bounds.north, bounds.east]
    ], {
      color: '#007acc', weight: 2, fillOpacity: 0.1, interactive: false
    }).addTo(this.map);

    const corners = [
      [bounds.north, bounds.west], 
      [bounds.north, bounds.east], 
      [bounds.south, bounds.east], 
      [bounds.south, bounds.west]  
    ];

    corners.forEach((corner, index) => {
      const marker = L.marker(corner as L.LatLngTuple, {
        icon: this.handleIcon,
        draggable: true
      }).addTo(this.map);

      marker.on('drag', (e) => {
        this.syncRectangle(index, e.target.getLatLng());
      });

      marker.on('dragend', () => {
        this.commitBounds();
      });

      this.handles.push(marker);
    });

    projectState.bbox = bounds;
    projectState.onBboxChange(bounds);
  }

  private syncRectangle(draggedIndex: number, newLatLng: L.LatLng) {
    const h = this.handles;
    const lat = newLatLng.lat;
    const lng = newLatLng.lng;

    if (draggedIndex === 0) { // NW
      h[1].setLatLng([lat, h[1].getLatLng().lng]); 
      h[3].setLatLng([h[3].getLatLng().lat, lng]); 
    } else if (draggedIndex === 1) { // NE
      h[0].setLatLng([lat, h[0].getLatLng().lng]); 
      h[2].setLatLng([h[2].getLatLng().lat, lng]); 
    } else if (draggedIndex === 2) { // SE
      h[3].setLatLng([lat, h[3].getLatLng().lng]); 
      h[1].setLatLng([h[1].getLatLng().lat, lng]); 
    } else if (draggedIndex === 3) { // SW
      h[2].setLatLng([lat, h[2].getLatLng().lng]); 
      h[0].setLatLng([h[0].getLatLng().lat, lng]); 
    }

    const lats = h.map(m => m.getLatLng().lat);
    const lngs = h.map(m => m.getLatLng().lng);
    if (this.rectLayer) {
      this.rectLayer.setBounds([
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)]
      ]);
    }
  }

  private commitBounds() {
    const lats = this.handles.map(m => m.getLatLng().lat);
    const lngs = this.handles.map(m => m.getLatLng().lng);
    
    const bounds = {
      north: Math.max(...lats),
      south: Math.min(...lats),
      east: Math.max(...lngs),
      west: Math.min(...lngs)
    };
    
    projectState.bbox = bounds;
    projectState.onBboxChange(bounds);
  }
}