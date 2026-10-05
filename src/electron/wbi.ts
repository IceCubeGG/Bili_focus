import { createHash } from 'node:crypto';

const MIX = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13];

/** Bilibili's web request signature; public navigation keys stay in the native host. */
export function wbiKey(imgUrl: unknown, subUrl: unknown): string {
  const keyPart = (value: unknown) => {
    if (typeof value !== 'string') throw new Error('Could not prepare the uploader video request.');
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.hdslb.com') || url.username || url.password || url.port) throw new Error('Unexpected uploader signing key.');
    const key = /\/([a-f0-9]{32})\.[a-z]+$/i.exec(url.pathname)?.[1];
    if (!key) throw new Error('Unexpected uploader signing key.');
    return key;
  };
  const combined = keyPart(imgUrl) + keyPart(subUrl);
  return MIX.map(index => combined[index]).join('');
}

export function signWbi(parameters: Record<string, string>, key: string, now: number): Record<string, string> {
  const values = { ...parameters, wts: String(Math.floor(now / 1000)) };
  const sorted = Object.fromEntries(Object.entries(values).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([name, value]) => [name, value.replace(/[!'()*]/g, '')]));
  const query = new URLSearchParams(sorted).toString();
  return { ...sorted, w_rid: createHash('md5').update(query + key).digest('hex') };
}
