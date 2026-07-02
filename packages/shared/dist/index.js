// src/deep-merge.js
function deepMerge(target, source) {
  const result = { ...target };
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = result[key];
      if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
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
// src/file-utils.js
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
async function listFiles(dirPath, extension) {
  try {
    const dir = Bun.dir(dirPath);
    const files = [];
    for await (const file of dir) {
      if (file.isFile()) {
        if (!extension || file.name.endsWith(extension)) {
          files.push(file.name);
        }
      }
    }
    return files;
  } catch {
    return [];
  }
}
export {
  writeFile,
  readFile,
  listFiles,
  fileExists,
  deepMerge
};
