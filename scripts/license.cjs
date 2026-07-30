#!/usr/bin/env node
/**
 * כלי הנפקת רישיונות NF-Blaze (רץ אצל המפתח בלבד).
 *
 *   npm run license:issue -- --name "משרד תיווך אולמו" --days 90
 *   npm run license:issue -- --name "לקוח" --email a@b.com --days 365
 *   npm run license:issue -- --name "שותף" --forever
 *   npm run license:verify -- <KEY>
 *
 * המפתח הפרטי: secrets/license-private.pem — לעולם לא בגיט ולא בהתקנה. גבה אותו!
 */
const nodeCrypto = require('crypto')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const PRIVATE_KEY_PATH = path.join(ROOT, 'secrets', 'license-private.pem')
const PREFIX = 'NFB1'

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (!next || next.startsWith('--')) out[key] = true
      else {
        out[key] = next
        i++
      }
    } else out._.push(a)
  }
  return out
}

function loadPrivateKey() {
  if (!fs.existsSync(PRIVATE_KEY_PATH)) {
    console.error(`\n✗ לא נמצא מפתח פרטי ב-${PRIVATE_KEY_PATH}`)
    console.error('  אם זו התקנה חדשה — הרץ: npm run license:keygen')
    console.error('  אם יש לך גיבוי — שחזר אותו לשם.\n')
    process.exit(1)
  }
  return nodeCrypto.createPrivateKey(fs.readFileSync(PRIVATE_KEY_PATH, 'utf-8'))
}

function cmdKeygen() {
  if (fs.existsSync(PRIVATE_KEY_PATH)) {
    console.error('✗ כבר קיים מפתח פרטי. יצירת חדש תבטל את כל הרישיונות הקיימים!')
    console.error('  אם אתה בטוח — מחק ידנית את secrets/ ונסה שוב.')
    process.exit(1)
  }
  const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('ed25519')
  fs.mkdirSync(path.join(ROOT, 'secrets'), { recursive: true })
  fs.writeFileSync(PRIVATE_KEY_PATH, privateKey.export({ type: 'pkcs8', format: 'pem' }), 'utf-8')
  const pub = publicKey.export({ type: 'spki', format: 'pem' })
  fs.writeFileSync(path.join(ROOT, 'secrets', 'license-public.pem'), pub, 'utf-8')
  console.log('✓ נוצר זוג מפתחות ב-secrets/')
  console.log('\nהדבק את המפתח הציבורי ב-src/shared/license.ts (LICENSE_PUBLIC_KEY_PEM):\n')
  console.log(pub)
}

function cmdIssue(args) {
  const name = typeof args.name === 'string' ? args.name.trim() : ''
  if (!name) {
    console.error('✗ חסר --name "שם הלקוח"')
    process.exit(1)
  }
  const forever = Boolean(args.forever)
  const days = forever ? 0 : Number(args.days || 90)
  if (!forever && (!Number.isFinite(days) || days <= 0)) {
    console.error('✗ --days חייב להיות מספר חיובי (או --forever)')
    process.exit(1)
  }

  let exp
  if (!forever) {
    const d = new Date()
    d.setDate(d.getDate() + days)
    exp = d.toISOString().slice(0, 10)
  }

  const payload = {
    id: nodeCrypto.randomUUID().slice(0, 8),
    n: name,
    ...(typeof args.email === 'string' ? { e: args.email.trim() } : {}),
    ...(exp ? { exp } : {}),
    t: 'full',
    iat: new Date().toISOString().slice(0, 10)
  }

  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf-8'))
  const signature = nodeCrypto.sign(null, Buffer.from(`${PREFIX}.${payloadB64}`, 'utf-8'), loadPrivateKey())
  const key = `${PREFIX}.${payloadB64}.${b64url(signature)}`

  console.log('\n' + '='.repeat(64))
  console.log(`לקוח:    ${name}`)
  if (payload.e) console.log(`אימייל:  ${payload.e}`)
  console.log(`תוקף:    ${exp ? `עד ${exp} (${days} ימים)` : 'ללא הגבלה'}`)
  console.log(`מזהה:    ${payload.id}`)
  console.log('='.repeat(64))
  console.log('\nמפתח הרישיון — שלח ללקוח:\n')
  console.log(key)
  console.log('\nהלקוח מדביק אותו ב: הגדרות ← רישיון ← הפעל\n')

  // יומן הנפקות — כדי שתדע למי הנפקת
  const logPath = path.join(ROOT, 'secrets', 'issued-licenses.jsonl')
  fs.appendFileSync(logPath, JSON.stringify({ ...payload, key }) + '\n', 'utf-8')
}

function cmdVerify(args) {
  const key = (args._[0] || args.key || '').trim()
  if (!key) {
    console.error('✗ חסר מפתח: npm run license:verify -- <KEY>')
    process.exit(1)
  }
  const parts = key.split('.')
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    console.error('✗ מבנה מפתח שגוי')
    process.exit(1)
  }
  const pubPath = path.join(ROOT, 'secrets', 'license-public.pem')
  if (!fs.existsSync(pubPath)) {
    console.error('✗ לא נמצא מפתח ציבורי ב-secrets/')
    process.exit(1)
  }
  const ok = nodeCrypto.verify(
    null,
    Buffer.from(`${PREFIX}.${parts[1]}`, 'utf-8'),
    nodeCrypto.createPublicKey(fs.readFileSync(pubPath, 'utf-8')),
    b64urlDecode(parts[2])
  )
  const payload = JSON.parse(b64urlDecode(parts[1]).toString('utf-8'))
  console.log('חתימה תקינה:', ok ? '✓ כן' : '✗ לא')
  console.log('תוכן:', payload)
  if (payload.exp) {
    const left = Math.ceil((new Date(`${payload.exp}T23:59:59`) - new Date()) / 86400000)
    console.log('ימים שנותרו:', left)
  }
}

const args = parseArgs(process.argv.slice(2))
const cmd = args._[0] === 'keygen' || args.keygen ? 'keygen' : args._.shift() || 'issue'

if (cmd === 'keygen') cmdKeygen()
else if (cmd === 'verify') cmdVerify(args)
else cmdIssue(args)
