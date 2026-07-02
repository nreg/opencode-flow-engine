import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/deep-merge.ts
function deepMerge(target, source) {
  const result = { ...target };
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = result[key];
      if (Array.isArray(sourceValue) && Array.isArray(targetValue)) {
        result[key] = [...new Set([...targetValue, ...sourceValue])];
      } else if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
        result[key] = deepMerge(targetValue, sourceValue);
      } else if (sourceValue !== undefined) {
        result[key] = sourceValue;
      }
    }
  }
  return result;
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
// src/file-utils.ts
async function fileExists(path) {
  try {
    const file = Bun.file(path);
    return await file.exists();
  } catch {
    return false;
  }
}
async function readFile(path) {
  try {
    const file = Bun.file(path);
    if (await file.exists()) {
      return await file.text();
    }
    return null;
  } catch {
    return null;
  }
}
async function writeFile(path, content) {
  try {
    await Bun.write(path, content);
    return true;
  } catch {
    return false;
  }
}
async function atomicWriteFile(path, content) {
  const tmp = `${path}.tmp.${Date.now()}`;
  try {
    await Bun.write(tmp, content);
    const { rename } = await import("fs/promises");
    await rename(tmp, path);
    return true;
  } catch {
    try {
      const { unlink } = await import("fs/promises");
      await unlink(tmp);
    } catch {}
    return false;
  }
}
async function listFiles(dirPath, extension) {
  try {
    const { readdir } = await import("fs/promises");
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && (!extension || e.name.endsWith(extension))).map((e) => e.name);
  } catch {
    return [];
  }
}
async function directoryExists(dirPath) {
  try {
    const { stat } = await import("fs/promises");
    const stats = await stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}
async function readJsonFile(path) {
  const content = await readFile(path);
  if (!content)
    return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}
async function writeJsonFile(path, data) {
  try {
    await Bun.write(path, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}
async function atomicWriteJsonFile(path, data) {
  return atomicWriteFile(path, JSON.stringify(data, null, 2));
}
async function ensureDir(dirPath) {
  try {
    const { mkdir } = await import("fs/promises");
    await mkdir(dirPath, { recursive: true });
  } catch {}
}
export {
  writeJsonFile,
  writeFile,
  readJsonFile,
  readFile,
  listFiles,
  fileExists,
  ensureDir,
  directoryExists,
  deepMerge,
  atomicWriteJsonFile,
  atomicWriteFile
};
