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
const OWNER = ['256XXXXXXXX']; // ← replace with your number

if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR);

// ===== SIMPLE AI (OFFLINE) =====
function aiReply(text) {
    if (text.includes('money')) return '💰 Focus on skills, consistency & patience.';
    if (text.includes('bot')) return '🤖 I am a Lucky Tech Hub WhatsApp Bot.';
    if (text.includes('hello')) return '👋 Hello! How can I help?';
    return '🤖 I am thinking… try asking differently.';
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).send({ code: 'Number required' });

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

    // ===== FAST PAIRING FIX =====
    if (!state.creds.registered) {
        await delay(800);
        const code = await sock.requestPairingCode(num);
        return res.send({ code: code.match(/.{1,4}/g).join('-') });
    }

    sock.ev.on('connection.update', ({ connection }) => {
        if (connection === 'open') {
            console.log('✅ Bot Online');
        }
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
            
Admin:
.promote .demote .kick .tagall

AI:
.ai <question>

Media:
.sticker .toimg

Group:
.mute .unmute

Status:
.status .uptime .ping
`);
        }

        // ===== AI =====
        if (text.startsWith('.ai ')) {
            reply(aiReply(text.slice(4).toLowerCase()));
        }

        // ===== GROUP ADMIN =====
        if (isGroup) {
            const metadata = await sock.groupMetadata(from);
            const admins = metadata.participants
                .filter(p => p.admin)
                .map(p => p.id);

            const isAdmin = admins.includes(sender);

            if (text === '.tagall' && isAdmin) {
                let tags = metadata.participants.map(p => `@${p.id.split('@')[0]}`).join('\n');
                sock.sendMessage(from, { text: tags, mentions: metadata.participants.map(p => p.id) });
            }

            if (text === '.kick' && isAdmin && msg.message.extendedTextMessage?.contextInfo?.mentionedJid) {
                sock.groupParticipantsUpdate(from, msg.message.extendedTextMessage.contextInfo.mentionedJid, 'remove');
            }

            // Anti-link
            if (text.includes('https://chat.whatsapp.com') && !isAdmin) {
                await sock.sendMessage(from, { delete: msg.key });
            }
        }

        // ===== MEDIA =====
        if (text === '.sticker' && msg.message.imageMessage) {
            const buffer = await sock.downloadMediaMessage(msg);
            await sock.sendMessage(from, { sticker: buffer });
        }
    });
});

export default router;
