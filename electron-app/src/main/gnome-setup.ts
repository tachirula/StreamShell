import { exec, execSync } from 'child_process'
import { existsSync, lstatSync, statSync, symlinkSync, readlinkSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'

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

function runCapture(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

function runAsync(cmd: string): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    exec(cmd, (err, _stdout, stderr) => {
      resolve({ ok: !err, stderr: (stderr || err?.message || '').trim() })
    })
  })
}

/** Returns the Unix epoch (seconds) at which gnome-shell started. */
function getGnomeShellStartTime(): number | null {
  const pid = runCapture('pgrep -x gnome-shell')
  if (!pid) return null
  const uptime = runCapture(`ps -o etimes= -p ${pid}`)
  if (!uptime) return null
  const seconds = parseInt(uptime, 10)
  if (Number.isNaN(seconds)) return null
  return Math.floor(Date.now() / 1000) - seconds
}

function detectWayland(): boolean {
  return (
    process.env.XDG_SESSION_TYPE === 'wayland' ||
    !!process.env.WAYLAND_DISPLAY
  )
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
    if (!existsSync(installedPath)) {
      symlinkSync(repoExtensionPath, installedPath)
      return warnings
    }

    const stat = lstatSync(installedPath)
    if (!stat.isSymbolicLink()) {
      // Installed as a real directory (production .deb or manual copy).
      // Leave it alone — this is the expected layout outside dev.
      return warnings
    }

    const target = readlinkSync(installedPath)
    if (target !== repoExtensionPath) {
      warnings.push({
        key: 'symlinkElsewhere',
        params: { actual: target, expected: repoExtensionPath }
      })
    }
  } catch (err: any) {
    warnings.push({
      key: 'symlinkCheckFailed',
      params: { message: String(err?.message ?? err) }
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
    !existsSync(compiledPath) ||
    statSync(xmlPath).mtimeMs > statSync(compiledPath).mtimeMs

  if (!needsCompile) return warnings

  const { ok, stderr } = await runAsync(`glib-compile-schemas ${schemaDir}`)
  if (!ok) {
    warnings.push({
      key: 'schemaCompileFailed',
      params: { message: stderr || 'glib-compile-schemas failed', schemaDir }
    })
  }
  return warnings
}

/**
 * Detects whether extension.js was modified after gnome-shell started, which
 * means the version loaded in memory is stale and only a relogin will pick
 * up the changes on Wayland.
 */
function detectStaleExtension(repoExtensionPath: string): boolean {
  const extJs = join(repoExtensionPath, 'extension.js')
  if (!existsSync(extJs)) return false

  const shellStart = getGnomeShellStartTime()
  if (shellStart === null) return false

  const extMtime = Math.floor(statSync(extJs).mtimeMs / 1000)
  return extMtime > shellStart
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
  return runAsync(`gnome-extensions enable ${GNOME_EXTENSION_UUID}`).then(({ ok, stderr }) => {
    if (!ok) {
      console.warn('[StreamShell] Could not enable GNOME extension:', stderr)
    }
  })
}