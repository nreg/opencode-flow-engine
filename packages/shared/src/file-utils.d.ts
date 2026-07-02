/**
 * File utilities for sFlow
 */
/**
 * Check if file exists
 */
export declare function fileExists(path: string): Promise<boolean>;
/**
 * Read file content
 */
export declare function readFile(path: string): Promise<string | null>;
/**
 * Write file content
 */
export declare function writeFile(path: string, content: string): Promise<boolean>;
/**
 * List files in directory
 */
export declare function listFiles(dirPath: string, extension?: string): Promise<string[]>;
/**
 * Ensure directory exists
 */
export declare function ensureDir(dirPath: string): Promise<void>;
//# sourceMappingURL=file-utils.d.ts.map