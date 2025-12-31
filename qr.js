import express from 'express';
import fs from 'fs';
import pino from 'pino';
import {
    makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion,
    delay
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';

const router = express.Router();
const OWNER = ['256XXXXXXXX']; // replace with your WhatsApp number
const SESSION_DIR = './qr_sessions';

if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

// Simple AI offline
function aiReply(text) {
    text = text.toLowerCase();
    if (text.includes('money')) return '💰 Focus on skills, consistency & patience.';
    if (text.includes('bot')) return '🤖 I am a Lucky Tech Hub WhatsApp Bot.';
    if (text.includes('hello')) return '👋 Hello! How can I help?';
    return '🤖 I am thinking… try asking differently.';
}

// Remove file / folder helper
function removeFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) return false;
        fs.rmSync(filePath, { recursive: true, force: true });
        return true;
    } catch (e) {
        console.error('Error removing file:', e);
        return false;
    }
}

router.get('/', async (req, res) => {
    const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const dirs = `${SESSION_DIR}/session_${sessionId}`;
    if (!fs.existsSync(dirs)) fs.mkdirSync(dirs, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(dirs);
    const { version } = await fetchLatestBaileysVersion();

    let qrGenerated = false;
    let responseSent = false;

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'fatal' }),
        browser: Browsers.windows('Chrome'),
        markOnlineOnConnect: true
    });

    sock.ev.on('creds.update', saveCreds);

    const handleQRCode = async (qr) => {
        if (qrGenerated || responseSent) return;
        qrGenerated = true;

        try {
            const qrDataURL = await QRCode.toDataURL(qr);
            if (!responseSent) {
                responseSent = true;
                res.send({
                    qr: qrDataURL,
                    message: 'Scan this QR with your WhatsApp app',
                    instructions: [
                        '1. Open WhatsApp',
                        '2. Go to Settings > Linked Devices',
                        '3. Tap "Link a Device"',
                        '4. Scan the QR code above'
                    ]
                });
            }
        } catch (err) {
            console.error('QR generation error:', err);
            if (!responseSent) {
                responseSent = true;
                res.status(500).send({ code: 'Failed to generate QR' });
            }
        }
    };

    sock.ev.on('connection.update', async (update) => {
        const { connection, qr } = update;

        if (qr && !qrGenerated) await handleQRCode(qr);

        if (connection === 'open') {
            console.log('✅ Bot connected!');
            const ownerJid = jidNormalizedUser(OWNER[0] + '@s.whatsapp.net');
            await sock.sendMessage(ownerJid, {
                text: '✅ *Lucky Tech Hub Mini Bot Connected!*\nYour WhatsApp bot is online.\nType *.menu* to see commands.'
            });
        }

        if (connection === 'close') {
            console.log('❌ Connection closed. Clean session if unauthorized.');
        }
    });

    // ===== COMMAND HANDLER =====
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const isGroup = from.endsWith('@g.us');
        const sender = msg.key.participant || from;
        const isOwner = OWNER.includes(sender.split('@')[0]);
        const reply = (t) => sock.sendMessage(from, { text: t }, { quoted: msg });

        // Status
        if (text === '.status') reply('🟢 Online & Stable');
        if (text === '.uptime') reply(`⏳ ${process.uptime().toFixed(0)} seconds`);
        if (text === '.ping') reply('🏓 Pong');

        // Menu
        if (text === '.menu') {
            reply(`🤖 *Lucky Tech Hub Bot*
Admin: .promote .demote .kick .tagall
AI: .ai <question>
Media: .sticker .toimg
Group: .mute .unmute
Status: .status .uptime .ping`);
        }

        // AI
        if (text.startsWith('.ai ')) reply(aiReply(text.slice(4)));

        // Group moderation
        if (isGroup) {
            const metadata = await sock.groupMetadata(from);
            const admins = metadata.participants.filter(p => p.admin).map(p => p.id);
            const isAdmin = admins.includes(sender);

            if (text === '.tagall' && isAdmin) {
                const mentions = metadata.participants.map(p => p.id);
                const tags = mentions.map(m => `@${m.split('@')[0]}`).join('\n');
                sock.sendMessage(from, { text: tags, mentions });
            }

            if (text === '.kick' && isAdmin && msg.message.extendedTextMessage?.contextInfo?.mentionedJid) {
                sock.groupParticipantsUpdate(from, msg.message.extendedTextMessage.contextInfo.mentionedJid, 'remove');
            }

            // Anti-link
            if (text.includes('https://chat.whatsapp.com') && !isAdmin) {
                await sock.sendMessage(from, { delete: msg.key });
            }
        }

        // Media downloader
        if (text === '.sticker' && msg.message.imageMessage) {
            const buffer = await sock.downloadMediaMessage(msg);
            await sock.sendMessage(from, { sticker: buffer });
        }
    });

    // QR timeout cleanup
    setTimeout(() => {
        if (!responseSent) {
            responseSent = true;
            res.status(408).send({ code: 'QR generation timeout' });
            removeFile(dirs);
        }
    }, 30000);
});

// Global uncaught exception handler
process.on('uncaughtException', (err) => {
    const ignore = [
        "conflict", "not-authorized", "Socket connection timeout",
        "rate-overlimit", "Connection Closed", "Timed Out",
        "Value not found", "Stream Errored", "statusCode: 515",
        "statusCode: 503"
    ];
    if (!ignore.some(e => String(err).includes(e))) console.log('Caught exception:', err);
});

export default router;
