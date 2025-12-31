import express from 'express';
import fs from 'fs';
import pino from 'pino';
import {
    makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion,
    jidNormalizedUser,
    delay
} from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();
const SESSION_DIR = './session';
const OWNER = ['256789966218']; // <-- your WhatsApp number

if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

/* ================== MESSAGE PARSER (CRITICAL FIX) ================== */
const getText = (msg) => {
    if (!msg.message) return '';

    if (msg.message.conversation) return msg.message.conversation;
    if (msg.message.extendedTextMessage?.text)
        return msg.message.extendedTextMessage.text;
    if (msg.message.imageMessage?.caption)
        return msg.message.imageMessage.caption;
    if (msg.message.videoMessage?.caption)
        return msg.message.videoMessage.caption;
    if (msg.message.ephemeralMessage)
        return getText({ message: msg.message.ephemeralMessage.message });
    if (msg.message.viewOnceMessage)
        return getText({ message: msg.message.viewOnceMessage.message });

    return '';
};

/* ================== SIMPLE OFFLINE AI ================== */
function aiReply(text) {
    text = text.toLowerCase();
    if (text.includes('money')) return '💰 Focus on skills, patience and consistency.';
    if (text.includes('bot')) return '🤖 I am Lucky Tech Hub WhatsApp Bot.';
    if (text.includes('hello')) return '👋 Hello! How can I help you?';
    return '🤖 I am still learning. Try again.';
}

/* ================== ROUTE ================== */
router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).send({ code: 'Phone number required' });

    num = num.replace(/\D/g, '');
    const phone = pn('+' + num);
    if (!phone.isValid())
        return res.status(400).send({ code: 'Invalid phone number' });

    num = phone.getNumber('e164').replace('+', '');

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
        },
        logger: pino({ level: 'fatal' }),
        browser: Browsers.windows('Chrome'),
        markOnlineOnConnect: true,
        connectTimeoutMs: 30000,
        keepAliveIntervalMs: 20000
    });

    sock.ev.on('creds.update', saveCreds);

    /* ================== PAIRING CODE ================== */
    if (!state.creds.registered) {
        try {
            await delay(1000);
            const code = await sock.requestPairingCode(num);
            const formatted = code.match(/.{1,4}/g)?.join('-') || code;
            if (!res.headersSent) res.send({ code: formatted });
        } catch (err) {
            console.error(err);
            if (!res.headersSent)
                res.status(503).send({ code: 'Failed to get pairing code' });
        }
    }

    /* ================== CONNECTION ================== */
    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            console.log('✅ Bot connected');

            const ownerJid = jidNormalizedUser(OWNER[0] + '@s.whatsapp.net');
            await sock.sendMessage(ownerJid, {
                text:
`✅ *Lucky Tech Hub Mini Bot Connected*
Your bot is now online.

Type *.menu* to see commands.`
            });
        }

        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            if (code === 401) {
                console.log('❌ Session expired. Delete session & re-pair.');
            } else {
                console.log('🔁 Connection closed. Auto retry...');
            }
        }
    });

    /* ================== COMMAND HANDLER ================== */
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg || msg.key.fromMe) return;

        const text = getText(msg).trim();
        if (!text) return;

        const from = msg.key.remoteJid;
        const sender = msg.key.participant || from;
        const isGroup = from.endsWith('@g.us');

        const reply = (t) =>
            sock.sendMessage(from, { text: t }, { quoted: msg });

        /* ----- BASIC ----- */
        if (text === '.ping') return reply('🏓 Pong');
        if (text === '.alive') return reply('✅ Bot is running');
        if (text === '.status') return reply('🟢 Online');
        if (text === '.uptime')
            return reply(`⏳ ${process.uptime().toFixed(0)}s`);

        /* ----- MENU ----- */
        if (text === '.menu') {
            return reply(
`🤖 *Lucky Tech Hub Bot*

AI:
.ai <question>

Group:
.tagall
.kick @user

Media:
.sticker

System:
.ping
.status
.uptime`
            );
        }

        /* ----- AI ----- */
        if (text.startsWith('.ai '))
            return reply(aiReply(text.slice(4)));

        /* ----- GROUP MODERATION ----- */
        if (isGroup) {
            const meta = await sock.groupMetadata(from);
            const admins = meta.participants
                .filter(p => p.admin)
                .map(p => p.id);
            const isAdmin = admins.includes(sender);

            if (text === '.tagall' && isAdmin) {
                const mentions = meta.participants.map(p => p.id);
                const tagText = mentions
                    .map(j => `@${j.split('@')[0]}`)
                    .join('\n');
                return sock.sendMessage(from, { text: tagText, mentions });
            }

            if (
                text === '.kick' &&
                isAdmin &&
                msg.message.extendedTextMessage?.contextInfo?.mentionedJid
            ) {
                return sock.groupParticipantsUpdate(
                    from,
                    msg.message.extendedTextMessage.contextInfo.mentionedJid,
                    'remove'
                );
            }
        }

        /* ----- STICKER ----- */
        if (text === '.sticker' && msg.message.imageMessage) {
            const buffer = await sock.downloadMediaMessage(msg);
            return sock.sendMessage(from, { sticker: buffer });
        }
    });
});

export default router;
