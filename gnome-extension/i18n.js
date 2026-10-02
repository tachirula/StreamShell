import GLib from 'gi://GLib';

const TRANSLATIONS = {
    en: {
        waiting: '<b>Waiting for Twitch connection...</b>',
        latest: '↓ Jump to latest',
        replyTo: 'Reply to',
        messagePlaceholder: 'Write a message…',
        sendingMessage: 'Sending message…',
        messageSent: 'Message sent.',
        messageSendFailed: 'Could not send message. Check the Twitch connection and chat permissions.',
        profileAbout: 'About',
        profileMessages: 'Messages in this session',
        profileNoMessages: 'No messages from this user are in the retained session log.',
        profileLoading: 'Loading Twitch profile…',
        profileUnavailable: 'Profile details are unavailable.',
        closeProfile: 'Close profile',
    },
    es: {
        waiting: '<b>Esperando conexión a Twitch...</b>',
        latest: '↓ Ir a los nuevos',
        replyTo: 'Respuesta a',
        messagePlaceholder: 'Escribe un mensaje…',
        sendingMessage: 'Enviando mensaje…',
        messageSent: 'Mensaje enviado.',
        messageSendFailed: 'No se pudo enviar el mensaje. Comprueba la conexión y los permisos de chat.',
        profileAbout: 'Acerca de',
        profileMessages: 'Mensajes de esta sesión',
        profileNoMessages: 'No hay mensajes de este usuario en el registro conservado de la sesión.',
        profileLoading: 'Cargando perfil de Twitch…',
        profileUnavailable: 'Los datos del perfil no están disponibles.',
        closeProfile: 'Cerrar perfil',
    },
};

function detectLocale() {
    for (const name of GLib.get_language_names()) {
        const short = name.split(/[._]/)[0].toLowerCase();
        if (TRANSLATIONS[short])
            return short;
    }
    return 'en';
}

const locale = detectLocale();

export const T = key => TRANSLATIONS[locale][key] ?? TRANSLATIONS.en[key] ?? key;
export const WAITING_MARKUP = T('waiting');
