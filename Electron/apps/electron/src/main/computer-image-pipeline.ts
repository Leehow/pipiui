/**
 * Screenshot preparation for model delivery: bound the delivered image's long
 * edge and report the exact delivered dimensions plus the scale factors back
 * to driver pixels, so model coordinates live in the pixel space of the image
 * the model actually saw (and the host can map them back exactly).
 *
 * This module must stay node-safe — `cua-driver-host.ts` and its unit tests
 * import it under plain vitest. The Electron `nativeImage` implementation is
 * wired in `main/index.ts`.
 */
export interface ComputerImagePipeline {
  prepareScreenshot(
    png: Buffer,
    maxLongEdge: number,
  ): {
    png: Buffer;
    /** Delivered image pixel width (0 when the input was not a decodable PNG). */
    width: number;
    /** Delivered image pixel height (0 when the input was not a decodable PNG). */
    height: number;
    /** delivered/original on the x axis (1 when unscaled). */
    scaleX: number;
    /** delivered/original on the y axis (1 when unscaled). */
    scaleY: number;
  };
}

function pngDimensions(png: Buffer): { width: number; height: number } | undefined {
  // PNG signature (8 bytes), then the IHDR chunk: length(4) + "IHDR"(4) +
  // width(4, BE) + height(4, BE).
  if (png.length < 24) return undefined;
  if (png.readUInt32BE(0) !== 0x89504e47) return undefined;
  if (png.toString("ascii", 12, 16) !== "IHDR") return undefined;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * Test/headless fallback: never resizes. Reports zero dimensions for non-PNG
 * input (unit-test fixtures use placeholder strings); the host skips the
 * coordinate contract in that case.
 */
export function createIdentityPipeline(): ComputerImagePipeline {
  return {
    prepareScreenshot(png) {
      const size = pngDimensions(png) ?? { width: 0, height: 0 };
      return { png, width: size.width, height: size.height, scaleX: 1, scaleY: 1 };
    },
  };
}
