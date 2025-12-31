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
const OWNER = ['256XXXXXXXX']; // <-- replace with your WhatsApp number

if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR);

// ===== SIMPLE AI (OFFLINE) =====
function aiReply(text) {
    text = text.toLowerCase();
    if (text.includes('money')) return '💰 Focus on skills, consistency & patience.';
    if (text.includes('bot')) return '🤖 I am a Lucky Tech Hub WhatsApp Bot.';
    if (text.includes('hello')) return '👋 Hello! How can I help?';
    return '🤖 I am thinking… try asking differently.';
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).send({ code: 'Phone number required' });

    num = num.replace(/\D/g, '');
    const phone = pn('+' + num);
    if (!phone.isValid()) return res.status(400).send({ code: 'Invalid number' });
    num = phone.getNumber('e164').replace('+', '');

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
        },
        logger: pino({ level: 'fatal' }),
        browser: Browsers.windows('Chrome'),
        markOnlineOnConnect: true,
        connectTimeoutMs: 20000,
        keepAliveIntervalMs: 15000
    });

    sock.ev.on('creds.update', saveCreds);

    // ===== PAIRING CODE LOGIN =====
    if (!state.creds.registered) {
        try {
            await delay(800); // short wait
            const code = await sock.requestPairingCode(num);
            const formattedCode = code.match(/.{1,4}/g)?.join('-') || code;
            if (!res.headersSent) {
                console.log(`Pairing code for ${num}: ${formattedCode}`);
                res.send({ code: formattedCode });
            }
        } catch (err) {
            console.error('❌ Failed to request pairing code:', err);
            if (!res.headersSent) {
                res.status(503).send({ code: 'Failed to get pairing code. Check number and network.' });
            }
        }
    }

    // ===== CONNECTION NOTICE =====
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, isNewLogin }) => {
        if (connection === 'open') {
            console.log('✅ Bot connected!');
            const ownerJid = jidNormalizedUser(OWNER[0] + '@s.whatsapp.net');
            await sock.sendMessage(ownerJid, { text: '✅ *Lucky Tech Hub Mini Bot Connected!* \nYour WhatsApp bot is now online.\nType *.menu* to see commands.' });
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === 401) {
                console.log('❌ Unauthorized. Delete session folder and pair again.');
            } else {
                console.log('🔁 Connection closed. Retrying...');
            }
        }

        if (isNewLogin) console.log('🔐 New login via pairing code.');
    });

    // ===== COMMAND HANDLER =====
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = msg.message.conversation ||
            msg.message.extendedTextMessage?.text || '';

        const isGroup = from.endsWith('@g.us');
        const sender = msg.key.participant || from;
        const isOwner = OWNER.includes(sender.split('@')[0]);

        const reply = (t) => sock.sendMessage(from, { text: t }, { quoted: msg });

        // ===== STATUS =====
        if (text === '.status') reply('🟢 Online & Stable');
        if (text === '.uptime') reply(`⏳ ${process.uptime().toFixed(0)} seconds`);
        if (text === '.ping') reply('🏓 Pong');

        // ===== MENU =====
        if (text === '.menu') {
            reply(`🤖 *Lucky Tech Hub Bot*
Admin: .promote .demote .kick .tagall
AI: .ai <question>
Media: .sticker .toimg
Group: .mute .unmute
Status: .status .uptime .ping`);
        }

        // ===== AI =====
        if (text.startsWith('.ai ')) reply(aiReply(text.slice(4)));

        // ===== GROUP ADMIN / MODERATION =====
        if (isGroup) {
            const metadata = await sock.groupMetadata(from);
            const admins = metadata.participants.filter(p => p.admin).map(p => p.id);
            const isAdmin = admins.includes(sender);

            // Tag all
            if (text === '.tagall' && isAdmin) {
                const mentions = metadata.participants.map(p => p.id);
                const tags = mentions.map(m => `@${m.split('@')[0]}`).join('\n');
                sock.sendMessage(from, { text: tags, mentions });
            }

            // Kick mentioned
            if (text === '.kick' && isAdmin && msg.message.extendedTextMessage?.contextInfo?.mentionedJid) {
                sock.groupParticipantsUpdate(from, msg.message.extendedTextMessage.contextInfo.mentionedJid, 'remove');
            }

            // Anti-link
            if (text.includes('https://chat.whatsapp.com') && !isAdmin) {
                await sock.sendMessage(from, { delete: msg.key });
            }
        }

        // ===== MEDIA DOWNLOADER =====
        if (text === '.sticker' && msg.message.imageMessage) {
            const buffer = await sock.downloadMediaMessage(msg);
            await sock.sendMessage(from, { sticker: buffer });
        }
    });
});

export default router;
