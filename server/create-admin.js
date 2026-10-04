import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { openDatabase } from './database.js';
import { hashPassword, validPassword } from './passwords.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const argumentIndex = process.argv.indexOf('--username');
const username = argumentIndex >= 0 ? process.argv[argumentIndex + 1]?.trim() : '';

async function readPassword() {
  if (!process.stdin.isTTY) {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 1024) throw new Error('ورودی رمز عبور بیش از حد طولانی است.');
    }
    return input.replace(/\r?\n$/, '');
  }
  let muted = false;
  const silentOutput = new Writable({ write(chunk, encoding, done) { if (!muted) process.stdout.write(chunk, encoding); done(); } });
  const reader = createInterface({ input: process.stdin, output: silentOutput, terminal: true });
  try {
    process.stdout.write('رمز عبور مدیر (حداقل ۸ نویسه): ');
    muted = true;
    const password = await reader.question('');
    process.stdout.write('\nتکرار رمز عبور: ');
    const confirmation = await reader.question('');
    process.stdout.write('\n');
    if (password !== confirmation) throw new Error('دو رمز عبور یکسان نیستند.');
    return password;
  } finally { reader.close(); }
}

try {
  if (!username || !/^[A-Za-z0-9_.-]{3,40}$/.test(username)) throw new Error('نام کاربری را با --username وارد کنید؛ ۳ تا ۴۰ حرف لاتین، عدد، نقطه، خط تیره یا زیرخط.');
  const password = await readPassword();
  if (!validPassword(password)) throw new Error('رمز عبور باید ۸ تا ۱۲۸ نویسه داشته باشد.');
  const passwordHash = await hashPassword(password);
  const databasePath = process.env.DATABASE_PATH ? resolve(process.env.DATABASE_PATH) : resolve(repository, 'data/game.sqlite');
  const db = openDatabase(databasePath);
  try {
    db.prepare('INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)').run(username, passwordHash, Date.now());
    console.log(`حساب مدیر «${username}» ساخته شد. ورود از /admin`);
  } finally { db.close(); }
} catch (error) {
  const message = error.code === 'ERR_SQLITE_ERROR' && error.message.includes('UNIQUE') ? 'این نام کاربری مدیر قبلاً ثبت شده است.' : error.message;
  console.error(message);
  process.exitCode = 1;
}
