import fs from 'fs';
import path from 'path';
import { deflateSync } from 'zlib';
import JSZip from 'jszip';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

type Point3 = { x: number; y: number; z: number };
type Triangle3 = [Point3, Point3, Point3];
type ProjectedTriangle = {
  points: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
  depth: number;
  shade: number;
};

export type PlateThumbnailResult = {
  injected: boolean;
  plateIds: number[];
  reason?: string;
};

const LARGE_SIZE = 512;
const SMALL_SIZE = 128;
const MAX_TRIANGLES = 150_000;
const PLATE_GCODE_RE = /^Metadata\/plate_(\d+)\.gcode$/;

/**
 * Headless Bambu Studio/OrcaSlicer exports frequently omit the GUI-rendered
 * Metadata/plate_N.png files. Generate a lightweight isometric preview from
 * the source STL and inject the standard Bambu thumbnail names. This is
 * intentionally best-effort: a missing preview must never fail a valid slice.
 */
export async function injectPlateThumbnailsIfMissing(
  threeMfPath: string,
  sourceModelPath: string
): Promise<PlateThumbnailResult> {
  let tempPath: string | undefined;
  try {
    const original = await fs.promises.readFile(threeMfPath);
    const zip = await JSZip.loadAsync(original);
    const names = Object.keys(zip.files);
    const plateIds = names
      .map((name) => PLATE_GCODE_RE.exec(name))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number(match[1]))
      .filter((plateId) => !zip.file(`Metadata/plate_${plateId}.png`))
      .sort((a, b) => a - b);

    if (plateIds.length === 0) {
      return { injected: false, plateIds: [], reason: 'thumbnail already present or no sliced plate found' };
    }

    if (path.extname(sourceModelPath).toLowerCase() !== '.stl') {
      return { injected: false, plateIds, reason: 'source is not an STL' };
    }

    const triangles = await loadStlTriangles(sourceModelPath);
    if (triangles.length === 0) {
      return { injected: false, plateIds, reason: 'source STL contains no triangles' };
    }

    const largeRgba = renderIsometric(triangles, LARGE_SIZE);
    const smallRgba = downsampleRgba(largeRgba, LARGE_SIZE, SMALL_SIZE);
    const largePng = encodePng(largeRgba, LARGE_SIZE, LARGE_SIZE);
    const smallPng = encodePng(smallRgba, SMALL_SIZE, SMALL_SIZE);

    for (const plateId of plateIds) {
      zip.file(`Metadata/plate_${plateId}.png`, largePng);
      zip.file(`Metadata/plate_${plateId}_small.png`, smallPng);
    }

    const updated = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    tempPath = `${threeMfPath}.thumbnail-${process.pid}-${Date.now()}`;
    await fs.promises.writeFile(tempPath, updated);
    await fs.promises.rename(tempPath, threeMfPath);
    return { injected: true, plateIds };
  } catch (error) {
    if (tempPath) {
      await fs.promises.unlink(tempPath).catch(() => undefined);
    }
    return {
      injected: false,
      plateIds: [],
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function loadStlTriangles(stlPath: string): Promise<Triangle3[]> {
  const data = await fs.promises.readFile(stlPath);
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const parsedGeometry = new STLLoader().parse(arrayBuffer);
  const geometry = parsedGeometry.index ? parsedGeometry.toNonIndexed() : parsedGeometry;
  const position = geometry.getAttribute('position');
  if (!position) return [];

  const faceCount = Math.floor(position.count / 3);
  // A thumbnail cannot display more detail than its pixels. For pathological
  // meshes, take evenly distributed faces to bound post-slice latency.
  const stride = Math.max(1, Math.ceil(faceCount / MAX_TRIANGLES));
  const triangles: Triangle3[] = [];
  for (let face = 0; face < faceCount; face += stride) {
    const offset = face * 3;
    triangles.push([
      { x: position.getX(offset), y: position.getY(offset), z: position.getZ(offset) },
      { x: position.getX(offset + 1), y: position.getY(offset + 1), z: position.getZ(offset + 1) },
      { x: position.getX(offset + 2), y: position.getY(offset + 2), z: position.getZ(offset + 2) },
    ]);
  }
  geometry.dispose();
  return triangles;
}

function renderIsometric(triangles: Triangle3[], size: number): Buffer {
  const projected = triangles.map((triangle) => {
    const points = triangle.map(projectPoint) as ProjectedTriangle['points'];
    return {
      raw: points,
      depth: triangle.reduce((sum, point) => sum + point.x + point.y + point.z, 0) / 3,
      shade: faceShade(triangle),
    };
  });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const triangle of projected) {
    for (const point of triangle.raw) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }

  const extentX = Math.max(maxX - minX, Number.EPSILON);
  const extentY = Math.max(maxY - minY, Number.EPSILON);
  const scale = (size * 0.82) / Math.max(extentX, extentY);
  const offsetX = (size - extentX * scale) / 2 - minX * scale;
  const offsetY = (size - extentY * scale) / 2 - minY * scale;
  const drawable: ProjectedTriangle[] = projected.map((triangle) => ({
    points: triangle.raw.map((point) => ({
      x: point.x * scale + offsetX,
      y: point.y * scale + offsetY,
    })) as ProjectedTriangle['points'],
    depth: triangle.depth,
    shade: triangle.shade,
  }));
  drawable.sort((a, b) => a.depth - b.depth);

  const rgba = Buffer.alloc(size * size * 4);
  for (let pixel = 0; pixel < size * size; pixel++) {
    const offset = pixel * 4;
    rgba[offset] = 26;
    rgba[offset + 1] = 26;
    rgba[offset + 2] = 26;
    rgba[offset + 3] = 255;
  }

  for (const triangle of drawable) {
    fillTriangle(rgba, size, triangle);
  }
  return rgba;
}

function projectPoint(point: Point3): { x: number; y: number } {
  // Orthographic camera at roughly azimuth 45 degrees/elevation 30 degrees.
  return {
    x: (point.x - point.y) * Math.SQRT1_2,
    y: (point.x + point.y) / Math.sqrt(6) - (2 * point.z) / Math.sqrt(6),
  };
}

function faceShade([a, b, c]: Triangle3): number {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const normal = {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  };
  const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
  const light = (normal.x * -0.35 + normal.y * -0.2 + normal.z * 0.92) / length;
  return 0.48 + 0.52 * Math.abs(light);
}

function fillTriangle(rgba: Buffer, size: number, triangle: ProjectedTriangle): void {
  const [a, b, c] = triangle.points;
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denominator) < 1e-9) return;

  const red = Math.round(0 * triangle.shade);
  const green = Math.round(174 * triangle.shade);
  const blue = Math.round(66 * triangle.shade);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w1 = ((b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y)) / denominator;
      const w2 = ((c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y)) / denominator;
      const w3 = 1 - w1 - w2;
      if (w1 >= -1e-7 && w2 >= -1e-7 && w3 >= -1e-7) {
        const offset = (y * size + x) * 4;
        rgba[offset] = red;
        rgba[offset + 1] = green;
        rgba[offset + 2] = blue;
        rgba[offset + 3] = 255;
      }
    }
  }
}

function downsampleRgba(source: Buffer, sourceSize: number, targetSize: number): Buffer {
  const factor = sourceSize / targetSize;
  const output = Buffer.alloc(targetSize * targetSize * 4);
  for (let y = 0; y < targetSize; y++) {
    for (let x = 0; x < targetSize; x++) {
      const sums = [0, 0, 0, 0];
      let samples = 0;
      for (let sy = Math.floor(y * factor); sy < Math.floor((y + 1) * factor); sy++) {
        for (let sx = Math.floor(x * factor); sx < Math.floor((x + 1) * factor); sx++) {
          const sourceOffset = (sy * sourceSize + sx) * 4;
          for (let channel = 0; channel < 4; channel++) sums[channel] += source[sourceOffset + channel];
          samples++;
        }
      }
      const targetOffset = (y * targetSize + x) * 4;
      for (let channel = 0; channel < 4; channel++) output[targetOffset + channel] = Math.round(sums[channel] / samples);
    }
  }
  return output;
}

function encodePng(rgba: Buffer, width: number, height: number): Buffer {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (width * 4 + 1);
    scanlines[rowOffset] = 0;
    rgba.copy(scanlines, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
