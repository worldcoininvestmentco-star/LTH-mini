import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys'
import pino from 'pino'

async function pairBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session')
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    logger: pino({ level: 'silent' }),
    auth: state,
    version
  })

  sock.ev.on('creds.update', saveCreds)

  if (!sock.authState.creds.registered) {
    const phoneNumber = process.argv[2]
    if (!phoneNumber) {
      console.log('❌ Usage: node pair.js 256XXXXXXXXX')
      process.exit(1)
    }

    const code = await sock.requestPairingCode(phoneNumber)
    console.log(`\n🔗 Pairing Code for Lucky2 Bot:\n\n${code}\n`)
  }

  sock.ev.on('connection.update', ({ connection }) => {
    if (connection === 'open') {
      console.log('✅ Lucky2 Bot paired successfully')
      process.exit(0)
    }
  })
}

pairBot()
