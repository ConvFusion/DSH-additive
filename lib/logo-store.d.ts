/** Maximum upload size: 2 MiB is plenty for a logo and bounds request buffering. */
export declare const MAX_LOGO_BYTES: number;
export interface LogoMeta {
    mediaType: string;
    size: number;
    /** Epoch ms of the last successful upload — used as a cache-bust version. */
    updatedAt: number;
    /** sha256 of the stored bytes (hex) — lets callers detect content changes. */
    sha256: string;
}
export interface LogoStore {
    dir: string;
    upload(bytes: Uint8Array, declaredMediaType: string | null): Promise<LogoMeta>;
    read(): Promise<{
        bytes: Uint8Array;
        meta: LogoMeta;
    } | null>;
    remove(): Promise<boolean>;
}
/**
 * Sniff the actual image type from the leading bytes. Returns a media type
 * from EXT_BY_MEDIA, or null when the bytes are not a recognizable image.
 * SVG is sniffed structurally (and must not contain a <script> tag).
 */
export declare function sniffImageType(bytes: Uint8Array): string | null;
export declare function createLogoStore(): Promise<LogoStore>;
export declare class LogoStoreError extends Error {
    code: 'empty-body' | 'too-large' | 'not-an-image' | 'type-mismatch';
    constructor(code: LogoStoreError['code'], message: string);
}
/** Served path (browser stores this + a ?v= cache-bust in localStorage). */
export declare const LOGO_SERVED_PATH = "/dsh-additive/logo";
/** Resolve the media type of a stored logo's file extension (fallback for GET). */
export declare function mediaTypeByExt(ext: string): string | null;
//# sourceMappingURL=logo-store.d.ts.map