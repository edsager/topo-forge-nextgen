import type { MeshPieceData } from './ThreeViewManager';

export function exportToBambuOBJ(pieces: MeshPieceData[], filename: string = "TopoForge_Puzzle.obj") {
  console.log(`[Export] Compiling ${pieces.length} pieces into Bambu-ready OBJ...`);
  
  // Use an array to store text chunks to prevent browser memory crashes
  const chunks: string[] = [];
  chunks.push("# Topo Forge NextGen Extended OBJ\n");
  chunks.push("# Compatible with Bambu Studio Vertex Colors\n\n");

  let vertexOffset = 1; // OBJ files are 1-indexed, not 0-indexed!

  for (const p of pieces) {
    let chunk = `o Piece_${p.row}_${p.col}\n`;
    
    const pos = p.positions;
    const col = p.colors;
    const ind = p.indices;

    // 1. Write Vertices + Colors (v X Y Z R G B)
    const numVerts = pos.length / 3;
    for (let i = 0; i < numVerts; i++) {
      const x = pos[i * 3].toFixed(4);
      const y = pos[i * 3 + 1].toFixed(4);
      const z = pos[i * 3 + 2].toFixed(4);
      
      // We safely fall back to grey if colors are missing
      const r = col ? col[i * 3].toFixed(4) : "0.5000";
      const g = col ? col[i * 3 + 1].toFixed(4) : "0.5000";
      const b = col ? col[i * 3 + 2].toFixed(4) : "0.5000";
      
      chunk += `v ${x} ${y} ${z} ${r} ${g} ${b}\n`;
    }

    // 2. Write Faces / Triangles (f V1 V2 V3)
    const numFaces = ind.length / 3;
    for (let i = 0; i < numFaces; i++) {
      // Add the global offset so pieces don't share vertices
      const v1 = ind[i * 3] + vertexOffset;
      const v2 = ind[i * 3 + 1] + vertexOffset;
      const v3 = ind[i * 3 + 2] + vertexOffset;
      
      chunk += `f ${v1} ${v2} ${v3}\n`;
    }

    chunks.push(chunk);
    vertexOffset += numVerts;
  }

  console.log(`[Export] Packaging Blob and triggering download...`);
  
  // Package the chunks into a virtual file and force the browser to download it
  const blob = new Blob(chunks, { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  
  // Cleanup to free memory
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}