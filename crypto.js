/**
 * 企业微信智能机器人加解密模块
 */
import crypto from 'node:crypto';

export class WeComCrypto {
  constructor(token, encodingAESKey, receiverId = '') {
    this.token = token;
    this.receiverId = receiverId;
    this.aesKey = Buffer.from(encodingAESKey + '=', 'base64');
    this.iv = this.aesKey.subarray(0, 16);
  }

  verifySignature(signature, timestamp, nonce, echostr) {
    const arr = [this.token, timestamp, nonce, echostr].filter(Boolean).sort();
    const hash = crypto.createHash('sha1').update(arr.join('')).digest('hex');
    return hash === signature;
  }

  decrypt(encrypted) {
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.aesKey, this.iv);
    decipher.setAutoPadding(false);

    let decrypted = Buffer.concat([
      decipher.update(encrypted, 'base64'),
      decipher.final(),
    ]);

    const pad = decrypted[decrypted.length - 1];
    decrypted = decrypted.subarray(0, decrypted.length - pad);

    const msgLen = decrypted.readUInt32BE(16);
    const message = decrypted.subarray(20, 20 + msgLen).toString('utf8');
    const receiverId = decrypted.subarray(20 + msgLen).toString('utf8');

    return { message, receiverId };
  }

  encrypt(message) {
    const msgBuf = Buffer.from(message, 'utf8');
    const receiverBuf = Buffer.from(this.receiverId, 'utf8');

    const random = crypto.randomBytes(16);
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(msgBuf.length, 0);

    let data = Buffer.concat([random, lenBuf, msgBuf, receiverBuf]);

    const blockSize = 32;
    const pad = blockSize - (data.length % blockSize);
    data = Buffer.concat([data, Buffer.alloc(pad, pad)]);

    const cipher = crypto.createCipheriv('aes-256-cbc', this.aesKey, this.iv);
    cipher.setAutoPadding(false);

    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    return encrypted.toString('base64');
  }

  sign(timestamp, nonce, encrypted) {
    const arr = [this.token, timestamp, nonce, encrypted].sort();
    return crypto.createHash('sha1').update(arr.join('')).digest('hex');
  }
}
