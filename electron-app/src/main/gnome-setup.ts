import { execFile, execFileSync } from 'child_process'
import { existsSync, lstatSync, readdirSync, statSync, symlinkSync, readlinkSync } from 'fs'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'

export const GNOME_EXTENSION_UUID = 'chat-overlay@test'
export const GNOME_EXTENSION_NAME = 'Chat Overlay Test'

export type GnomeWarningKey =
  | 'repoNotFound'
  | 'symlinkElsewhere'
  | 'symlinkCheckFailed'
  | 'schemaCompileFailed'
  | 'staleWayland'
  | 'staleGeneric'

export interface GnomeWarning {
  key: GnomeWarningKey
  params?: Record<string, string>
}

export interface GnomeCheckResult {
  /** Non-fatal issues. The renderer translates them via their key. */
  warnings: GnomeWarning[]
  /** Fatal issues that prevent the overlay from working at all. */
  errors: string[]
  /** Set when the loaded extension.js is older than what's on disk. */
  needsRelogin: boolean
  /** Wayland sessions can't hot-reload extensions at all. */
  isWayland: boolean
}

// --- Repo root resolution ---------------------------------------------------

/**
 * Walks up from `start` until it finds a directory containing
 * `gnome-extension/extension.js`. That file only exists at the repo root,
 * so it's a reliable anchor regardless of where the built output ends up
 * (out/main, out/renderer, a future dist/, etc.).
 */
function findRepoRoot(start: string): string | null {
  let current = start
  while (true) {
    if (existsSync(join(current, 'gnome-extension', 'extension.js'))) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) return null // hit filesystem root
    current = parent
  }
}

/**
 * Resolves the absolute path to `gnome-extension/` in development.
 * Order of resolution:
 *   1. STREAMSHELL_REPO_ROOT env var (explicit override, e.g. for CI).
 *   2. Walk up from __dirname looking for the `gnome-extension/extension.js`
 *      marker file.
 *   3. Fall back to the old relative path (should not be needed in practice).
 */
export function resolveRepoExtensionPath(): string {
  if (process.env.STREAMSHELL_REPO_ROOT) {
    return join(process.env.STREAMSHELL_REPO_ROOT, 'gnome-extension')
  }
  const root = findRepoRoot(__dirname)
  if (root) return join(root, 'gnome-extension')
  return join(__dirname, '../../../gnome-extension')
}

// --- Shell helpers ----------------------------------------------------------

function runCapture(command: string, args: string[] = []): string | null {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return null
  }
}

function runAsync(command: string, args: string[] = []): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    execFile(command, args, (err, _stdout, stderr) => {
      resolve({ ok: !err, stderr: (stderr || err?.message || '').trim() })
    })
  })
}

/** Returns the start times for every running GNOME Shell process. */
function getGnomeShellStartTimes(): number[] {
  const pids =
    runCapture('pgrep', ['-x', 'gnome-shell'])
      ?.split(/\s+/)
      .filter((pid) => /^\d+$/.test(pid)) ?? []
  return pids.flatMap((pid) => {
    const elapsed = runCapture('ps', ['-o', 'etimes=', '-p', pid])
    const seconds = elapsed ? Number.parseInt(elapsed, 10) : Number.NaN
    return Number.isFinite(seconds) ? [Math.floor(Date.now() / 1000) - seconds] : []
  })
}

function detectWayland(): boolean {
  return process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY
}

// --- Dev-only checks --------------------------------------------------------

/**
 * Dev-mode only: ensure the extension directory is a symlink pointing at the
 * repo, so editing extension.js here is immediately visible on disk.
 */
function ensureSymlink(repoExtensionPath: string): GnomeWarning[] {
  const warnings: GnomeWarning[] = []
  const installedPath = join(
    homedir(),
    '.local',
    'share',
    'gnome-shell',
    'extensions',
    GNOME_EXTENSION_UUID
  )

  if (!existsSync(repoExtensionPath)) {
    warnings.push({ key: 'repoNotFound', params: { path: repoExtensionPath } })
    return warnings
  }

  try {
    let stat
    try {
      stat = lstatSync(installedPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      try {
        symlinkSync(repoExtensionPath, installedPath)
      } catch (createError) {
        if ((createError as NodeJS.ErrnoException).code !== 'EEXIST') throw createError
        stat = lstatSync(installedPath)
      }
      if (!stat) return warnings
    }

    if (!stat.isSymbolicLink()) {
      // Installed as a real directory (production .deb or manual copy).
      // Leave it alone — this is the expected layout outside dev.
      return warnings
    }

    const target = resolve(dirname(installedPath), readlinkSync(installedPath))
    if (target !== resolve(repoExtensionPath)) {
      warnings.push({
        key: 'symlinkElsewhere',
        params: { actual: target, expected: resolve(repoExtensionPath) }
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    warnings.push({
      key: 'symlinkCheckFailed',
      params: { message }
    })
  }
  return warnings
}

/** Ensures the GSettings schema is compiled and up to date. */
async function ensureSchemaCompiled(repoExtensionPath: string): Promise<GnomeWarning[]> {
  const warnings: GnomeWarning[] = []
  const schemaDir = join(repoExtensionPath, 'schemas')
  const xmlPath = join(schemaDir, 'org.gnome.shell.extensions.chat-overlay.gschema.xml')
  const compiledPath = join(schemaDir, 'gschemas.compiled')

  if (!existsSync(xmlPath)) return warnings

  const needsCompile =
    !existsSync(compiledPath) || statSync(xmlPath).mtimeMs > statSync(compiledPath).mtimeMs

  if (!needsCompile) return warnings

  const { ok, stderr } = await runAsync('glib-compile-schemas', [schemaDir])
  if (!ok) {
    warnings.push({
      key: 'schemaCompileFailed',
      params: { message: stderr || 'glib-compile-schemas failed', schemaDir }
    })
  }
  return warnings
}

/**
 * Detects changes to any source or schema loaded by GNOME Shell after it
 * started, which means a relogin is required on Wayland.
 */
function detectStaleExtension(repoExtensionPath: string): boolean {
  const shellStartTimes = getGnomeShellStartTimes()
  if (shellStartTimes.length === 0) return false
  const shellStartedAt = Math.min(...shellStartTimes)
  const extensionModules = readdirSync(repoExtensionPath)
    .filter((file) => file.endsWith('.js'))
    .map((file) => join(repoExtensionPath, file))
  const schemaDir = join(repoExtensionPath, 'schemas')
  const schemaFiles = existsSync(schemaDir)
    ? readdirSync(schemaDir)
        .filter((file) => file.endsWith('.xml') || file === 'gschemas.compiled')
        .map((file) => join(schemaDir, file))
    : []
  return [...extensionModules, ...schemaFiles].some(
    (path) => Math.floor(statSync(path).mtimeMs / 1000) > shellStartedAt
  )
}

// --- Public API -------------------------------------------------------------

/**
 * Runs every GNOME-related check. In development it also fixes what it can
 * (creates the symlink, compiles the schema). In production it only reports.
 */
export async function checkGnomeSetup(
  isDev: boolean,
  repoExtensionPath: string
): Promise<GnomeCheckResult> {
  const result: GnomeCheckResult = {
    warnings: [],
    errors: [],
    needsRelogin: false,
    isWayland: detectWayland()
  }

  if (process.platform !== 'linux') return result

  if (isDev) {
    result.warnings.push(...ensureSymlink(repoExtensionPath))
    result.warnings.push(...(await ensureSchemaCompiled(repoExtensionPath)))
  }

  result.needsRelogin = detectStaleExtension(repoExtensionPath)

  if (result.needsRelogin) {
    result.warnings.push({
      key: result.isWayland ? 'staleWayland' : 'staleGeneric'
    })
  }

  return result
}

/** Enables the extension (idempotent). Non-fatal on failure. */
export function ensureGnomeExtensionEnabled(): Promise<void> {
  if (process.platform !== 'linux') return Promise.resolve()
  return runAsync('gnome-extensions', ['enable', GNOME_EXTENSION_UUID]).then(({ ok, stderr }) => {
    if (!ok) {
      console.warn('[StreamShell] Could not enable GNOME extension:', stderr)
    }
  })
}
