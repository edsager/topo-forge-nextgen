export interface RGB { r: number; g: number; b: number; }
export interface LAB { l: number; a: number; b: number; }

// The 7-Color NextGen AMS Palette
export const AMS_PALETTE: RGB[] = [
  { r: 255, g: 255, b: 255 }, // 0. Snow White
  { r: 120, g: 180, b: 100 }, // 1. Light Green
  { r: 34,  g: 102, b: 51  }, // 2. Dark Green
  { r: 101, g: 67,  b: 33  }, // 3. Earth Brown
  { r: 150, g: 150, b: 150 }, // 4. Light Grey
  { r: 40,  g: 40,  b: 40  }, // 5. Dark Grey / Black
  { r: 30,  g: 80,  b: 160 }  // 6. Deep Blue
];

export function rgbToLab(rgb: RGB): LAB {
  let r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;

  r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  let y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000;
  let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;

  x = x > 0.008856 ? Math.pow(x, 1/3) : (7.787 * x) + 16/116;
  y = y > 0.008856 ? Math.pow(y, 1/3) : (7.787 * y) + 16/116;
  z = z > 0.008856 ? Math.pow(z, 1/3) : (7.787 * z) + 16/116;

  return {
    l: (116 * y) - 16,
    a: 500 * (x - y),
    b: 200 * (y - z)
  };
}

export function colorDistance(lab1: LAB, lab2: LAB): number {
  return Math.sqrt(
    Math.pow(lab1.l - lab2.l, 2) +
    Math.pow(lab1.a - lab2.a, 2) +
    Math.pow(lab1.b - lab2.b, 2)
  );
}

const paletteLab = AMS_PALETTE.map(rgbToLab);

export function snapToAMS(r: number, g: number, b: number): RGB {
  const targetLab = rgbToLab({ r, g, b });
  
  let minDistance = Infinity;
  let bestMatch = AMS_PALETTE[0];

  for (let i = 0; i < AMS_PALETTE.length; i++) {
    const dist = colorDistance(targetLab, paletteLab[i]);
    if (dist < minDistance) {
      minDistance = dist;
      bestMatch = AMS_PALETTE[i];
    }
  }

  return bestMatch;
}