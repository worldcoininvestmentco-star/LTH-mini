import express from 'express';
import fs from 'fs';
import pino from 'pino';
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();
const SESSION_DIR = './session';

// Ensure session folder exists
if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR);
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).send({ code: 'Phone number required' });

    num = num.replace(/[^0-9]/g, '');
    const phone = pn('+' + num);
    if (!phone.isValid()) {
        return res.status(400).send({ code: 'Invalid phone number' });
    }

    num = phone.getNumber('e164').replace('+', '');

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
        logger: pino({ level: "fatal" }),
        browser: Browsers.windows('Chrome'),
        printQRInTerminal: false,
        markOnlineOnConnect: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection } = update;

        if (connection === 'open') {
            console.log('✅ Bot connected & ready');

            await sock.sendMessage(jidNormalizedUser(num + '@s.whatsapp.net'), {
                text: `✅ *Lucky Tech Hub Mini Bot Activated*\n\nType *.menu* to see commands`
            });
        }

        if (connection === 'close') {
            console.log('🔁 Reconnecting...');
        }
    });

    if (!state.creds.registered) {
        await delay(3000);
        const code = await sock.requestPairingCode(num);
        return res.send({ code: code.match(/.{1,4}/g).join('-') });
    }

    // ================= COMMAND HANDLER =================
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            '';

        const from = msg.key.remoteJid;

        const reply = (txt) =>
            sock.sendMessage(from, { text: txt }, { quoted: msg });

        switch (text.toLowerCase()) {

            case '.menu':
                reply(`🤖 *Lucky Tech Hub Mini Bot*
                
1. .ping
2. .alive
3. .time
4. .date
5. .owner
6. .about
7. .help
8. .status
9. .uptime
10. .joke
11. .quote
12. .hi
13. .bye
14. .rules
15. .thanks
`);
                break;

            case '.ping': reply('🏓 Pong!'); break;
            case '.alive': reply('✅ Bot is alive'); break;
            case '.time': reply(`⏰ Time: ${new Date().toLocaleTimeString()}`); break;
            case '.date': reply(`📅 Date: ${new Date().toDateString()}`); break;
            case '.owner': reply('👤 Owner: Lucky Tech Hub'); break;
            case '.about': reply('🤖 Mini WhatsApp Bot powered by Lucky Tech Hub'); break;
            case '.help': reply('Type *.menu* to see commands'); break;
            case '.status': reply('🟢 Online & stable'); break;
            case '.uptime': reply(`⏳ Uptime: ${process.uptime().toFixed(0)}s`); break;
            case '.joke': reply('😂 Why did JS break up? Too many promises!'); break;
            case '.quote': reply('💬 Success comes from consistency.'); break;
            case '.hi': reply('👋 Hello there!'); break;
            case '.bye': reply('👋 Goodbye!'); break;
            case '.rules': reply('📜 No spam. Be respectful.'); break;
            case '.thanks': reply('🙏 You’re welcome!'); break;
        }
    });
});

export default router;
