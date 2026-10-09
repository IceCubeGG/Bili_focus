// Tiny locally recorded fragmented MP4 fixtures; no third-party media is downloaded.
const assert = require('node:assert/strict');
module.exports = function indexedMp4(input, durationMs = 2000) {
  const data = Buffer.from(input); let offset = 0, boundary = -1;
  while (offset + 8 <= data.length) { const size = data.readUInt32BE(offset), type = data.toString('ascii', offset + 4, offset + 8); assert.ok(size >= 8 && offset + size <= data.length); if (type === 'moof') { boundary = offset; break; } offset += size; }
  assert.ok(boundary > 0, 'Recorder must produce fragmented MP4');
  const index = Buffer.alloc(44); index.writeUInt32BE(44, 0); index.write('sidx', 4); index.writeUInt32BE(1, 12); index.writeUInt32BE(1000, 16); index.writeUInt16BE(1, 30); index.writeUInt32BE(data.length - boundary, 32); index.writeUInt32BE(durationMs, 36); index.writeUInt32BE(0x90000000, 40);
  const result = Buffer.concat([data.subarray(0, boundary), index, data.subarray(boundary)]);
  const avc = data.indexOf(Buffer.from('avcC'));
  return { bytes: new Uint8Array(result), initialization: `0-${boundary - 1}`, indexRange: `${boundary}-${boundary + 43}`, codecs: avc < 0 ? 'mp4a.40.2' : `avc1.${data.subarray(avc + 5, avc + 8).toString('hex')}` };
};
