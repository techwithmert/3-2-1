import fs from 'node:fs'
import path from 'node:path'

export const CACHE_DIR = path.join(import.meta.dirname, '..', '.cache')

export function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
}

export function cachePath(name: string): string {
  return path.join(CACHE_DIR, name)
}

/** Append JSON lines to a cache file. */
export function appendNdjson(name: string, rows: unknown[]) {
  if (rows.length === 0) return
  fs.appendFileSync(cachePath(name), rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
}

/** Read all JSON lines from a cache file (empty array if missing). */
export function readNdjson<T>(name: string): T[] {
  const file = cachePath(name)
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as T)
}

export function readJson<T>(name: string, fallback: T): T {
  const file = cachePath(name)
  if (!fs.existsSync(file)) return fallback
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T
}

export function writeJson(name: string, value: unknown) {
  fs.writeFileSync(cachePath(name), JSON.stringify(value))
}
