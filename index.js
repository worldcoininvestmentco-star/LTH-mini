import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} from '@whiskeysockets/baileys'
import pino from 'pino'

const OWNER = '256XXXXXXXXX@s.whatsapp.net' // replace with your number
const PREFIX = '.'

const autoReplies = {
  hi: '👋 Hello! Welcome to Lucky2 Bot.',
  hello: '😊 Hi there! How can I help?',
  help: '📌 Type .menu to see commands'
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session')
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    logger: pino({ level: 'silent' }),
    auth: state,
    version
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode
      if (reason !== DisconnectReason.loggedOut) {
        startBot()
      }
    }

    if (connection === 'open') {
      sock.sendMessage(OWNER, {
        text: `✅ *Lucky2 Bot Connected*\n\nType *.menu* to see commands.`
      })
      console.log('🤖 Lucky2 Bot Online')
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return

    const from = msg.key.remoteJid
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      ''

    const isAdmin = from === OWNER

    /* AUTO-REPLY */
    const lower = text.toLowerCase()
    if (autoReplies[lower]) {
      return sock.sendMessage(from, { text: autoReplies[lower] })
    }

    if (!text.startsWith(PREFIX)) return

    const command = text.slice(1).trim().split(' ')[0]

    switch (command) {
      case 'menu':
        sock.sendMessage(from, {
          text:
`📜 *Lucky2 Bot Menu*

• .menu
• .ping
• .alive
• .time
• .about
• .owner
• .echo <text>

👑 Admin Commands
• .status
• .restart
• .broadcast <msg>
• .addreply key|value
• .delreply key`
        })
        break

      case 'ping':
        sock.sendMessage(from, { text: '🏓 Pong!' })
        break

      case 'alive':
        sock.sendMessage(from, { text: '✅ Lucky2 Bot is alive' })
        break

      case 'time':
        sock.sendMessage(from, { text: new Date().toLocaleString() })
        break

      case 'about':
        sock.sendMessage(from, {
          text: '🤖 Lucky2 Bot\nBuilt with Node.js & Baileys'
        })
        break

      case 'owner':
        sock.sendMessage(from, { text: '👑 Owner: Lucky Tech Hub' })
        break

      case 'echo':
        sock.sendMessage(from, { text: text.replace('.echo', '') })
        break

      /* 🔐 ADMIN FEATURES */
      case 'status':
        if (!isAdmin) return
        sock.sendMessage(from, { text: '✅ Bot running normally' })
        break

      case 'restart':
        if (!isAdmin) return
        sock.sendMessage(from, { text: '♻ Restarting bot...' })
        process.exit(0)
        break

      case 'broadcast':
        if (!isAdmin) return
        const msgText = text.replace('.broadcast', '').trim()
        if (!msgText) return
        sock.sendMessage(from, { text: '📢 Broadcast sent (demo)' })
        break

      case 'addreply':
        if (!isAdmin) return
        const [key, value] = text.replace('.addreply', '').split('|')
        if (key && value) {
          autoReplies[key.trim().toLowerCase()] = value.trim()
          sock.sendMessage(from, { text: '✅ Auto-reply added' })
        }
        break

      case 'delreply':
        if (!isAdmin) return
        const delKey = text.replace('.delreply', '').trim().toLowerCase()
        delete autoReplies[delKey]
        sock.sendMessage(from, { text: '🗑 Auto-reply removed' })
        break
    }
  })
}

startBot()
