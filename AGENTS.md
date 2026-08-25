# Agent Instructions for Topo Forge NextGen

## Project Overview

**Topo Forge NextGen** is a WebGL-based 3D topographic puzzle generator. Users draw geographic boundaries on a map, and the system generates 3D-printable puzzle pieces from real elevation and satellite data.

- **Entry point**: [index.html](index.html) + [src/main.ts](src/main.ts)
- **Tech**: TypeScript, Vite, Three.js (3D), Leaflet (2D mapping), GeoTIFF (geospatial data), Manifold-3D (mesh ops)
- **Build**: `npm run dev`, `npm run build`, `npm run preview`

## Architecture

### Folder Structure
- **`src/components/`** — UI controllers (MapContainer for Leaflet-based map interaction)
- **`src/core/`** — Core business logic:
  - `api.ts` — Elevation, satellite, land cover data fetching from AWS Terrarium
  - `ThreeViewManager.ts` — 3D scene, camera, renderer, mesh rendering
  - `colorMath.ts` — Color scheme/gradient calculations for elevation
  - `exporter.ts` — OBJ export for 3D printing (Bambu Studio format)
- **`src/geometry/`** — Mesh generation:
  - `meshAssembler.ts` — Build mesh from elevation grid + colors
  - `puzzleMath.ts` — Compute cut lines and puzzle piece boundaries
- **`src/state/`** — Simple state object ([projectState.ts](src/state/projectState.ts)) with bbox, gridResolution, exaggeration
- **`src/workers/`** — Web Worker for background mesh computation ([mesh.worker.ts](src/workers/mesh.worker.ts))

### Data Flow
1. User draws bounding box on Leaflet map (MapContainer)
2. API fetches elevation grid + satellite/land cover rasters (api.ts)
3. Mesh worker processes grid into 3D geometry (mesh.worker.ts)
4. ThreeViewManager renders the 3D scene and mesh pieces
5. User exports to OBJ for 3D printing (exporter.ts)

### State Management
- **Central state**: [src/state/projectState.ts](src/state/projectState.ts) — simple object with callbacks (not Redux/Pinia)
- **Key properties**: `bbox`, `gridResolution`, `exaggeration`, `isPuzzle`
- **Pattern**: Direct object mutations + callback invocations; no strict immutability

## Development Patterns

### TypeScript & Linting
- **Target**: ES2023
- **Strict mode enabled**: `noUnusedLocals`, `noUnusedParameters`, no fallthrough cases
- **Import resolution**: bundler mode with allowImportingTsExtensions
- **Key requirement**: Always satisfy type checker; unused code is not allowed

### UI & DOM
- Direct DOM manipulation via `getElementById()` and `addEventListener()`
- UI state drives 3D view updates (via ThreeViewManager)
- Map interactions dispatch state changes, which cascade to 3D view

### 3D Graphics (Three.js)
- Scene uses Z-axis for elevation (camera `up` vector = [0, 0, 1])
- Lighting setup in [ThreeViewManager.setupLighting()](src/core/ThreeViewManager.ts)
- Mesh pieces passed as `MeshPieceData` interface with positions, indices, optional colors
- OrbitControls enabled for interactive 3D navigation

### Web Workers
- Mesh computation offloaded to [mesh.worker.ts](src/workers/mesh.worker.ts) to avoid blocking UI
- Communication via `postMessage()` / `onmessage`
- Worker receives elevation grid, returns mesh geometry

## Common Tasks

### Add a New Feature
1. Define types/interfaces (use strict TypeScript)
2. Update [projectState.ts](src/state/projectState.ts) if new global state needed
3. Add UI controls in [index.html](index.html)
4. Wire event listeners in [main.ts](src/main.ts)
5. Implement logic in appropriate core/ or geometry/ module
6. Test build: `npm run build` must pass TypeScript check

### Fix a Bug
- Check TypeScript errors first: `npm run build`
- Most issues are in [main.ts](src/main.ts) (event wiring), [ThreeViewManager.ts](src/core/ThreeViewManager.ts) (3D rendering), or [api.ts](src/core/api.ts) (data fetching)
- Use console logs; no debugger setup yet

### Modify Mesh/Geometry
- Edit [meshAssembler.ts](src/geometry/meshAssembler.ts) or [puzzleMath.ts](src/geometry/puzzleMath.ts)
- Update [mesh.worker.ts](src/workers/mesh.worker.ts) if changing data format passed between threads
- Remember: normals matter for lighting; use `BufferGeometry.computeVertexNormals()` after modifying positions

### Add Data Export Format
- Update [exporter.ts](src/core/exporter.ts)
- Current: Bambu Studio OBJ format with z-exaggeration baked in

## Key APIs & Libraries

| Library | Purpose | Docs |
|---------|---------|------|
| Three.js | 3D scene, camera, renderer, meshes | https://threejs.org/docs/ |
| Leaflet | 2D map UI, drawing | https://leafletjs.com/ |
| GeoTIFF | Parse elevation/satellite rasters | https://geotiffjs.io/ |
| Manifold-3D | Boolean mesh operations | https://manifold3d.org/ |
| Vite | Build/dev server | https://vitejs.dev/ |

## Known Limitations & Gotchas

1. **No minification of unused vars**: Strict TypeScript means all imported types/functions must be used or explicitly marked `// @ts-ignore`
2. **Direct DOM access**: No reactive framework; UI syncing relies on manual event listeners in [main.ts](src/main.ts)
3. **Web Worker communication**: Ensure data structures are serializable (no Functions, no circular refs)
4. **Three.js Camera**: Z-axis is elevation; camera `up` is [0, 0, 1], not [0, 1, 0]
5. **Elevation data**: AWS Terrarium returns RGB terrain tiles; must decode to meters (see [api.ts](src/core/api.ts) for formula)

## Commands for Cline

```bash
# Development
npm run dev          # Start Vite dev server (localhost:5173)

# Build & type check
npm run build        # Compile TypeScript + bundle with Vite
npm run preview      # Preview production build locally

# Common editing flow
# 1. Make changes
# 2. Run `npm run build` to check for TypeScript errors
# 3. Test in dev server (`npm run dev`)
```

## Next Steps / Future Enhancements

- UI framework (React/Vue) to replace direct DOM manipulation
- Unit tests (currently none)
- E2E tests for export formats
- API rate limiting / caching for elevation/satellite tiles
- Puzzle piece physics simulation (fitting/assembly preview)
