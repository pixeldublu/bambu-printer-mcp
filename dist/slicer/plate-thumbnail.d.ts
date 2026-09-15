export type PlateThumbnailResult = {
    injected: boolean;
    plateIds: number[];
    reason?: string;
};
/**
 * Headless Bambu Studio/OrcaSlicer exports frequently omit the GUI-rendered
 * Metadata/plate_N.png files. Generate a lightweight isometric preview from
 * the source STL and inject the standard Bambu thumbnail names. This is
 * intentionally best-effort: a missing preview must never fail a valid slice.
 */
export declare function injectPlateThumbnailsIfMissing(threeMfPath: string, sourceModelPath: string): Promise<PlateThumbnailResult>;
