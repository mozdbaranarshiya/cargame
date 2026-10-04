import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const parameters = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const dummySalt = randomBytes(16).toString('hex');
const dummyHash = `scrypt$${dummySalt}$${scryptSync(randomBytes(32), dummySalt, 64, parameters).toString('hex')}`;

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64, parameters);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  const [algorithm, salt, encodedHash] = (storedHash || dummyHash).split('$');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(encodedHash || '')) return false;
  const actual = await derive(password, salt, 64, parameters);
  return timingSafeEqual(actual, Buffer.from(encodedHash, 'hex')) && Boolean(storedHash);
}

export function validPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}
