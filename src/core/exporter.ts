// src/core/exporter.ts
import type { MeshPieceData } from './ThreeViewManager';

export function exportToBambuOBJ(pieces: MeshPieceData[], filename: string) {
    // FIX 2: Using a high-speed array buffer instead of looping strings
    const lines: string[] = [];
    lines.push("# TopoForge NextGen Multi-Color OBJ Export");
    
    let vertexOffset = 1;
    
    for (const piece of pieces) {
        lines.push(`o ${piece.id}`);
        const v = piece.vertexArray;
        const c = piece.colorArray;
        const ind = piece.indexArray;
        
        // Export Vertices AND Colors on the same line for Bambu Studio mapping
        for (let i = 0; i < v.length; i += 3) {
            lines.push(`v ${v[i].toFixed(4)} ${v[i+1].toFixed(4)} ${v[i+2].toFixed(4)} ${c[i].toFixed(4)} ${c[i+1].toFixed(4)} ${c[i+2].toFixed(4)}`);
        }
        
        // Export Faces, tracking the global index offset
        for (let i = 0; i < ind.length; i += 3) {
            lines.push(`f ${ind[i] + vertexOffset} ${ind[i+1] + vertexOffset} ${ind[i+2] + vertexOffset}`);
        }
        
        vertexOffset += (v.length / 3);
    }
    
    // Package instantly and trigger browser download
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}