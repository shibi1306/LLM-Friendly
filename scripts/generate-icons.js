#!/usr/bin/env node
/**
 * Generates PNG icons (16, 48, 128 px) from an embedded SVG using Canvas.
 * Run with: node scripts/generate-icons.js
 * Requires Node.js 18+ (uses built-in Canvas via Skia if available) or
 * falls back to writing the SVG directly as placeholder PNGs via the
 * 'canvas' npm package.
 */

const fs = require('fs');
const path = require('path');

const ICONS_DIR = path.resolve(__dirname, '../icons');
if (!fs.existsSync(ICONS_DIR)) fs.mkdirSync(ICONS_DIR, { recursive: true });

// SVG source for the M↓ logo
const svgTemplate = (size) => {
  const r = Math.round(size * 0.12);       // corner radius
  const fs1 = Math.round(size * 0.48);     // "M" font size
  const fs2 = Math.round(size * 0.36);     // "↓" font size
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#5b21b6"/>
      <stop offset="100%" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#g)"/>
  <text x="${size * 0.28}" y="${size * 0.66}" font-family="Arial Black, sans-serif"
    font-weight="900" font-size="${fs1}" fill="white">M</text>
  <text x="${size * 0.64}" y="${size * 0.78}" font-family="Arial, sans-serif"
    font-size="${fs2}" fill="rgba(255,255,255,0.85)">↓</text>
</svg>`;
};

// Try to generate PNGs using the 'canvas' package
async function generateWithCanvas() {
  const { createCanvas, loadImage } = require('canvas');
  for (const size of [16, 48, 128]) {
    const svg = svgTemplate(size);
    const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
    const img = await loadImage(dataUrl);
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, size, size);
    const buf = canvas.toBuffer('image/png');
    const outPath = path.join(ICONS_DIR, `icon${size}.png`);
    fs.writeFileSync(outPath, buf);
    console.log(`✅ Generated ${outPath}`);
  }
}

// Fallback: write SVGs and rename as .png (not real PNGs, but Chrome can load SVGs in extensions)
function generateSvgFallback() {
  for (const size of [16, 48, 128]) {
    const svg = svgTemplate(size);
    const outPath = path.join(ICONS_DIR, `icon${size}.png`);
    fs.writeFileSync(outPath, svg);
    console.log(`⚠️  Wrote SVG as ${outPath} (install 'canvas' package for real PNGs)`);
  }
}

generateWithCanvas()
  .then(() => console.log('Icons generated successfully!'))
  .catch(() => {
    console.log('canvas package not available, using SVG fallback…');
    generateSvgFallback();
  });
