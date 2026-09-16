// src/core/exporter.ts

export function exportToBambuOBJ(pieces: any[], filename: string) {
    const lines: string[] = [];
    lines.push("# TopoForge NextGen Multi-Color OBJ Export");
    
    let vertexOffset = 1;
    
    for (const piece of pieces) {
        lines.push(`o ${piece.id}`);
        // Pulling the safely renamed arrays
        const v = piece.vertices || piece.positions || piece.vertexArray;
        const c = piece.colors || piece.colorArray;
        const ind = piece.indices || piece.indexArray;
        
        for (let i = 0; i < v.length; i += 3) {
            // Absolute check to prevent NaN corruption in Bambu Studio
            const vx = isNaN(v[i]) ? 0 : v[i];
            const vy = isNaN(v[i+1]) ? 0 : v[i+1];
            const vz = isNaN(v[i+2]) ? 0 : v[i+2];
            const cr = isNaN(c[i]) ? 0.5 : c[i];
            const cg = isNaN(c[i+1]) ? 0.5 : c[i+1];
            const cb = isNaN(c[i+2]) ? 0.5 : c[i+2];
            
            lines.push(`v ${vx.toFixed(4)} ${vy.toFixed(4)} ${vz.toFixed(4)} ${cr.toFixed(4)} ${cg.toFixed(4)} ${cb.toFixed(4)}`);
        }
        
        for (let i = 0; i < ind.length; i += 3) {
            lines.push(`f ${ind[i] + vertexOffset} ${ind[i+1] + vertexOffset} ${ind[i+2] + vertexOffset}`);
        }
        
        vertexOffset += (v.length / 3);
    }
    
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}