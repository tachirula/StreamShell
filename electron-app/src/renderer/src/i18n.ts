// Minimal i18n module. Add new languages by extending `dictionaries` and
// `Locale`. Keys are flat strings; params are interpolated with {name}.

export type Locale = 'en' | 'es'

const dictionaries: Record<Locale, Record<string, string>> = {
  en: {
    'panel.subtitle': 'Overlay Control Panel',
    'panel.channelLabel': 'Twitch Channel:',
    'panel.channelPlaceholder': 'e.g. hashiruta',
    'panel.connect': 'Connect to Chat',
    'panel.connecting': 'Connecting...',
    'panel.cancel': 'Cancel connection',
    'panel.retry': 'Retry connection',
    'panel.status.connected': 'Receiving messages from',
    'panel.status.error': 'Connection error:',
    'gnome.warningTitle': 'GNOME Shell warning',
    'gnome.dismiss': 'Dismiss warning',
    'gnome.warn.repoNotFound': 'Repository not found at {path}. Did you move it?',
    'gnome.warn.symlinkElsewhere': 'Extension symlink points to {actual}, not {expected}. Delete it and reopen the app to recreate it.',
    'gnome.warn.symlinkCheckFailed': 'Could not verify the extension symlink: {message}',
    'gnome.warn.schemaCompileFailed': 'Could not compile the GSettings schema ({message}). Run manually: glib-compile-schemas {schemaDir}',
    'gnome.warn.staleWayland': 'Extension files changed since you logged in. On Wayland, GNOME Shell does not hot-reload extensions: log out and back in once for the changes to take effect.',
    'gnome.warn.staleGeneric': 'Extension files changed since you logged in. Log out (or restart GNOME Shell) for the changes to take effect.'
  },
  es: {
    'panel.subtitle': 'Panel de Control del Overlay',
    'panel.channelLabel': 'Canal de Twitch:',
    'panel.channelPlaceholder': 'Ej: hashiruta',
    'panel.connect': 'Conectar al Chat',
    'panel.connecting': 'Conectando...',
    'panel.cancel': 'Cancelar conexión',
    'panel.retry': 'Reintentar conexión',
    'panel.status.connected': 'Recibiendo mensajes de',
    'panel.status.error': 'Error al conectar:',
    'gnome.warningTitle': 'Aviso de GNOME Shell',
    'gnome.dismiss': 'Cerrar aviso',
    'gnome.warn.repoNotFound': 'No encuentro el repo en {path}. ¿Lo moviste?',
    'gnome.warn.symlinkElsewhere': 'El symlink de la extensión apunta a {actual}, no a {expected}. Bórralo y reabre la app para que se recree.',
    'gnome.warn.symlinkCheckFailed': 'No pude verificar el symlink de la extensión: {message}',
    'gnome.warn.schemaCompileFailed': 'No pude compilar el schema GSettings ({message}). Corre manualmente: glib-compile-schemas {schemaDir}',
    'gnome.warn.staleWayland': 'Los archivos de la extensión cambiaron desde que iniciaste sesión. En Wayland GNOME Shell no recarga extensiones en caliente: cierra sesión y vuelve a entrar una vez para que los cambios surtan efecto.',
    'gnome.warn.staleGeneric': 'Los archivos de la extensión cambiaron desde que iniciaste sesión. Cierra sesión (o recarga GNOME Shell) para que los cambios surtan efecto.'
  }
}

function detectLocale(): Locale {
  const raw = (navigator.language || 'en').toLowerCase()
  if (raw.startsWith('es')) return 'es'
  return 'en'
}

const currentLocale: Locale = detectLocale()

/**
 * Translate a key. Missing keys fall back to English, then to the key itself
 * (so typos are visible without crashing the UI).
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const value = dictionaries[currentLocale][key]
    ?? dictionaries.en[key]
    ?? key

  if (!params) return value

  return Object.entries(params).reduce(
    (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)),
    value
  )
}

export function getLocale(): Locale {
  return currentLocale
}