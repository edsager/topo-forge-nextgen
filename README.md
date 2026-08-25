# Topo Forge NextGen

Topo Forge NextGen is a browser-based, client-side 3D terrain generator that converts real-world geographic data into interlocking, multi-color 3D-printable jigsaw puzzles. 
All available material with this project is copyrighted and otherwise protected under whatever applicable legal protections, whether local, national, or international.
Built with multi-material 3D printers in mind (like the Bambu Lab AMS ecosystem), this tool bypasses the need for complex CAD software or proprietary map scraping. It dynamically pulls open-source elevation, satellite, and land-cover data to generate mathematically perfect, slice-ready `.obj` files right in your web browser.

## Key Features

*   **Dynamic Jigsaw Generation:** Define your total map width and grid dimensions (e.g., 4x4 or 6x6 pieces). The engine applies a continuous 0.15mm tolerance gap across the entire puzzle edge, ensuring pieces snap together perfectly without fusing in the slicer.
*   **The "Water Drop" Shoreline Effect:** Automatically detects lakes, rivers, and oceans using both Copernicus satellite data and visual RGB scanning. It physically depresses the water by your exact slicer layer height (e.g., 0.2mm or 0.4mm), allowing for instant, one-click paint bucket fills in Bambu Studio without triggering massive print-time penalties.
*   **Major Road Networks:** Integrates with the OpenStreetMap Overpass API to extract major highways and motorways, raising them slightly from the terrain and assigning a distinct asphalt grey color.
*   **GPX Trail Integration:** Upload custom `.gpx` trail files to physically emboss hiking trails or routes directly into the 3D mesh.
*   **Biome Detection & Shadow Fixing:** Uses the ESA Copernicus Land Cover database to accurately assign biomes (forest, dirt, snow) to filament spools, overriding dark satellite shadows that typically confuse basic color extractors.
*   **Client-Side Processing:** All heavy 3D boolean geometry and mesh slicing is performed locally in your browser via WebWorkers and WebAssembly (Manifold3D), requiring no backend servers.

## Tech Stack

*   **Framework:** Vite + TypeScript
*   **Mapping:** Leaflet.js
*   **3D Geometry Engine:** Manifold3D (WebAssembly)
*   **Data Sources:** Mapzen/AWS (Elevation), ArcGIS (Satellite), ESA Copernicus (Land Cover), OpenStreetMap Overpass (Roads).

## Local Development

To run this project locally on your machine, you will need Node.js installed.

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/YourUsername/topo-forge-nextgen.git](https://github.com/YourUsername/topo-forge-nextgen.git)
   cd topo-forge-nextgen

Install dependencies:

Bash
npm install

Start the local development server:

Bash
npm run dev
Open the provided localhost link in your browser to view the application.

Build for production:

Bash
npm run build
This packages the optimized application into the dist folder, ready for deployment to hosts like Netlify

   3D Printing Recommendations
For the best results, especially on Bambu Lab printers:

Nozzle: 0.4mm is recommended for large terrain boards to keep print times manageable.

Layer Height: 0.2mm standard.

Infill: 10% with 1 or 2 wall loops is generally sufficient for terrain tiles.

Coloring: Use the height-range modifier or the smart fill tool to color the depressed water layers and raised GPX/Road networks. Ensure your selected "Water Drop" in the app matches a direct multiple of your layer height in the slicer to avoid unnecessary filament swaps.

## ⚖️ License

This project is licensed under the [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-nc-sa/4.0/). 

You are free to:
* **Share** — copy and redistribute the material in any medium or format.
* **Adapt** — remix, transform, and build upon the material.

Under the following terms:
* **NonCommercial** — You may **not** use the material for commercial purposes, including selling the software, hosting it for profit, or utilizing it for commercial advantage.
* **ShareAlike** — If you remix, transform, or build upon the material, you **must** distribute your contributions under the same license as the original.
* **Attribution** — You must give appropriate credit, provide a link to the license, and indicate if and what changes were made.

* 
