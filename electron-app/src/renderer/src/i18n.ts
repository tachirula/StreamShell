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
    'twitch.error.joinTimeout':
      'Could not join Twitch channel "{channel}" before the request timed out.',
    'twitch.error.twitchNotice': 'Twitch rejected the connection: {message}',
    'twitch.error.connectionFailed': 'Could not connect to Twitch: {reason}',
    'settings.open': 'Settings',
    'settings.title': 'Settings',
    'settings.back': 'Back to chat',
    'settings.chatShortcut': 'Chat visibility shortcut',
    'settings.shortcutNotSet': 'Not set',
    'settings.shortcutClear': 'Clear',
    'settings.shortcutRecording': 'Recording… press a key combination',
    'settings.shortcutInstruction':
      'Hold one or more modifiers, then press the key. Press Escape to cancel. Super/Windows is reserved.',
    'settings.shortcutSuperReserved': 'Super/Windows is reserved by GNOME.',
    'settings.shortcutUnsupportedKey': 'This key cannot be used for a shortcut.',
    'settings.shortcutNeedsModifier':
      'Add at least one modifier such as Ctrl, Shift, Alt or AltGr.',
    'settings.shortcutWayland':
      'On Wayland, log out and back in once after this update so GNOME Shell can load the shortcut keybinding.',
    'settings.shortcutHardwareNote':
      'Fn is handled by many keyboards before the operating system and may not be recordable. Some system keys can be reserved by GNOME.',
    'settings.chatSize': 'Chat size',
    'settings.chatWidth': 'Maximum width',
    'settings.visibleBeforeScroll': 'Messages visible before scrolling',
    'settings.chatBackground': 'Chat background',
    'settings.backgroundOpacity': 'Background opacity',
    'settings.history': 'Session history',
    'settings.historyEnabled': 'Enable session history and scrolling',
    'settings.historyLimit': 'Messages retained for scrolling',
    'settings.historyRisk':
      'Higher values keep more messages and emote images in memory and may briefly load many emotes. Maximum: 100 messages.',
    'settings.emoteQuality': 'Third-party emote quality',
    'settings.thirdPartyEmotesEnabled': 'Enable support for BTTV, FFZ and 7TV',
    'settings.thirdPartyEmotesHelp':
      'When disabled, third-party emote codes stay as plain text and their APIs are not queried.',
    'settings.emoteBestQuality': 'Always use the best available quality',
    'settings.emoteImageScale': 'Requested image size',
    'settings.emoteQualityCacheHint':
      'For best results after changing quality, clear the image cache below while disconnected from Twitch.',
    'settings.downloads': 'Image downloads',
    'settings.concurrentDownloads': 'Maximum simultaneous downloads',
    'settings.concurrentDownloadsHelp':
      'Choose from 1 to 16. Higher values may download emotes faster but use more network bandwidth and system resources.',
    'settings.backendWaylandNote':
      'This backend setting applies immediately and does not require logging out. GNOME extension code changes on Wayland require logging out and back in.',
    'settings.cache': 'Image cache',
    'settings.clearCache': 'Clear image cache',
    'settings.cacheRecommendation': 'For best results, clear the cache while no stream is active.',
    'settings.cacheStreaming': 'Disconnect from the stream before clearing the cache.',
    'settings.cacheCleared': 'Image cache cleared.',
    'settings.cacheError': 'Could not clear image cache:',
    'settings.loadError': 'Could not load settings:',
    'gnome.warningTitle': 'GNOME Shell warning',
    'gnome.dismiss': 'Dismiss warning',
    'gnome.warn.repoNotFound': 'Repository not found at {path}. Did you move it?',
    'gnome.warn.symlinkElsewhere':
      'Extension symlink points to {actual}, not {expected}. Delete it and reopen the app to recreate it.',
    'gnome.warn.symlinkCheckFailed': 'Could not verify the extension symlink: {message}',
    'gnome.warn.schemaCompileFailed':
      'Could not compile the GSettings schema ({message}). Run manually: glib-compile-schemas {schemaDir}',
    'gnome.warn.staleWayland':
      'Extension files changed since you logged in. On Wayland, GNOME Shell does not hot-reload extensions: log out and back in once for the changes to take effect.',
    'gnome.warn.staleGeneric':
      'Extension files changed since you logged in. Log out (or restart GNOME Shell) for the changes to take effect.'
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
    'twitch.error.joinTimeout':
      'No se pudo entrar al canal de Twitch "{channel}" antes de que venciera el tiempo de espera.',
    'twitch.error.twitchNotice': 'Twitch rechazó la conexión: {message}',
    'twitch.error.connectionFailed': 'No se pudo conectar a Twitch: {reason}',
    'settings.open': 'Configuración',
    'settings.title': 'Configuración',
    'settings.back': 'Volver al chat',
    'settings.chatShortcut': 'Atajo para mostrar u ocultar el chat',
    'settings.shortcutNotSet': 'Sin asignar',
    'settings.shortcutClear': 'Borrar',
    'settings.shortcutRecording': 'Grabando… presiona una combinación',
    'settings.shortcutInstruction':
      'Mantén uno o más modificadores y luego presiona la tecla. Escape cancela. Super/Windows está reservada.',
    'settings.shortcutSuperReserved': 'Super/Windows está reservada por GNOME.',
    'settings.shortcutUnsupportedKey': 'Esta tecla no se puede usar en un atajo.',
    'settings.shortcutNeedsModifier':
      'Agrega al menos un modificador, como Ctrl, Shift, Alt o AltGr.',
    'settings.shortcutWayland':
      'En Wayland, cierra sesión y vuelve a entrar una vez después de esta actualización para que GNOME Shell cargue el atajo.',
    'settings.shortcutHardwareNote':
      'Muchos teclados procesan Fn antes de enviarla al sistema, por lo que quizá no se pueda grabar. GNOME también puede reservar algunas teclas del sistema.',
    'settings.chatSize': 'Tamaño del chat',
    'settings.chatWidth': 'Ancho máximo',
    'settings.visibleBeforeScroll': 'Mensajes visibles antes de desplazar',
    'settings.chatBackground': 'Fondo del chat',
    'settings.backgroundOpacity': 'Opacidad del fondo',
    'settings.history': 'Historial de esta sesión',
    'settings.historyEnabled': 'Activar historial de sesión y desplazamiento',
    'settings.historyLimit': 'Mensajes que se conservan para desplazarse',
    'settings.historyRisk':
      'Un valor alto conserva más mensajes e imágenes de emotes en memoria y puede cargar muchos emotes de golpe. Máximo: 100 mensajes.',
    'settings.emoteQuality': 'Calidad de emotes de terceros',
    'settings.thirdPartyEmotesEnabled': 'Activar soporte para BTTV, FFZ y 7TV',
    'settings.thirdPartyEmotesHelp':
      'Al desactivarlo, los códigos de emotes de terceros se muestran como texto y no se consultan sus APIs.',
    'settings.emoteBestQuality': 'Usar siempre la mejor calidad disponible',
    'settings.emoteImageScale': 'Tamaño de imagen solicitado',
    'settings.emoteQualityCacheHint':
      'Para mejores resultados después de cambiar la calidad, borra la caché de imágenes abajo cuando estés desconectado de Twitch.',
    'settings.downloads': 'Descargas de imágenes',
    'settings.concurrentDownloads': 'Máximo de descargas simultáneas',
    'settings.concurrentDownloadsHelp':
      'Elige entre 1 y 16. Un valor mayor puede descargar emotes más rápido, pero usa más ancho de banda y recursos del sistema.',
    'settings.backendWaylandNote':
      'Este ajuste del backend se aplica inmediatamente y no requiere cerrar sesión. Los cambios al código de la extensión GNOME en Wayland sí requieren cerrar sesión y volver a entrar.',
    'settings.cache': 'Caché de imágenes',
    'settings.clearCache': 'Borrar caché de imágenes',
    'settings.cacheRecommendation':
      'Para mejores resultados, borra la caché cuando no haya un stream activo.',
    'settings.cacheStreaming': 'Desconéctate del stream antes de borrar la caché.',
    'settings.cacheCleared': 'Caché de imágenes borrada.',
    'settings.cacheError': 'No se pudo borrar la caché de imágenes:',
    'settings.loadError': 'No se pudo cargar la configuración:',
    'gnome.warningTitle': 'Aviso de GNOME Shell',
    'gnome.dismiss': 'Cerrar aviso',
    'gnome.warn.repoNotFound': 'No encuentro el repo en {path}. ¿Lo moviste?',
    'gnome.warn.symlinkElsewhere':
      'El symlink de la extensión apunta a {actual}, no a {expected}. Bórralo y reabre la app para que se recree.',
    'gnome.warn.symlinkCheckFailed': 'No pude verificar el symlink de la extensión: {message}',
    'gnome.warn.schemaCompileFailed':
      'No pude compilar el schema GSettings ({message}). Corre manualmente: glib-compile-schemas {schemaDir}',
    'gnome.warn.staleWayland':
      'Los archivos de la extensión cambiaron desde que iniciaste sesión. En Wayland GNOME Shell no recarga extensiones en caliente: cierra sesión y vuelve a entrar una vez para que los cambios surtan efecto.',
    'gnome.warn.staleGeneric':
      'Los archivos de la extensión cambiaron desde que iniciaste sesión. Cierra sesión (o recarga GNOME Shell) para que los cambios surtan efecto.'
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
  const value = dictionaries[currentLocale][key] ?? dictionaries.en[key] ?? key

  if (!params) return value

  return Object.entries(params).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), value)
}

export function getLocale(): Locale {
  return currentLocale
}
