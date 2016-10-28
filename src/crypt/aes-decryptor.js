class AESDecryptor {
  constructor(keyBuffer) {
    // convert keyBuffer to Uint32Array
    let key = this.uint8ArrayToUint32Array_(keyBuffer);
    let keySize = this.keySize = key.length;

    if (keySize !== 4 && keySize !== 6 && keySize !== 8) {
      throw new Error('Invalid aes key size=' + keySize);
    }

    let nRounds = keySize + 6;
    this.ksRows = (nRounds + 1) * 4;
    this.keyWords = key;
    this.subMix = [];
    this.invSubMix = [];
    this.initTable();
    this.expandKey();
  }

  uint8ArrayToUint32Array_(arrayBuffer) {
    let view = new DataView(arrayBuffer);
    let newArray = new Uint32Array(4);
    for (let i = 0; i < newArray.length; i++) {
      newArray[i] = view.getUint32(i * 4);
    }
    return newArray;
  }

  initTable() {
    let sBox = this.sBox = new Uint32Array(256);
    let invSBox = this.invSBox= new Uint32Array(256);
    let subMix0 = this.subMix[0] = new Uint32Array(256);
    let subMix1 = this.subMix[1] = new Uint32Array(256);
    let subMix2 = this.subMix[2] = new Uint32Array(256);
    let subMix3 = this.subMix[3] = new Uint32Array(256);
    let invSubMix0 = this.invSubMix[0] = new Uint32Array(256);
    let invSubMix1 = this.invSubMix[1] = new Uint32Array(256);
    let invSubMix2 = this.invSubMix[2] = new Uint32Array(256);
    let invSubMix3 = this.invSubMix[3] = new Uint32Array(256);
    this.rcon = [0x0, 0x1, 0x2, 0x4, 0x8, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

    let d = new Uint32Array(256);
    let x = 0;
    let xi = 0;
    let i = 0;
    for (i = 0; i < 256; i++) {
      if (i < 128) {
        d[i] = i << 1;
      } else {
        d[i] = (i << 1) ^ 0x11b;
      }
    }

    for (i = 0; i < 256; i++) {
      let sx = xi ^ (xi << 1) ^ (xi << 2) ^ (xi << 3) ^ (xi << 4);
      sx = (sx >>> 8) ^ (sx & 0xff) ^ 0x63;
      sBox[x] = sx;
      invSBox[sx] = x;

      // Compute multiplication
      let x2 = d[x];
      let x4 = d[x2];
      let x8 = d[x4];

      // Compute sub/invSub bytes, mix columns tables
      let t = (d[sx] * 0x101) ^ (sx * 0x1010100);
      subMix0[x] = (t << 24) | (t >>> 8);
      subMix1[x] = (t << 16) | (t >>> 16);
      subMix2[x] = (t << 8) | (t >>> 24);
      subMix3[x] = t;

      // Compute inv sub bytes, inv mix columns tables
      t = (x8 * 0x1010101) ^ (x4 * 0x10001) ^ (x2 * 0x101) ^ (x * 0x1010100);
      invSubMix0[sx] = (t << 24) | (t >>> 8);
      invSubMix1[sx] = (t << 16) | (t >>> 16);
      invSubMix2[sx] = (t << 8) | (t >>> 24);
      invSubMix3[sx] = t;

      // Compute next counter
      if (!x) {
        x = xi = 1;
      } else {
        x = x2 ^ d[d[d[x8 ^ x2]]];
        xi ^= d[d[xi]];
      }
    }
  }

  expandKey() {
    let keySchedule = this.keySchedule = new Uint32Array(this.ksRows).fill(0);
    let rcon = this.rcon;
    let invKeySchedule = this.invKeySchedule = new Uint32Array(this.ksRows).fill(0);
    let keySize = this.keySize;
    let keyWords = this.keyWords;
    let ksRows = this.ksRows;
    let sbox = this.sBox;
    let invSubMix0 = this.invSubMix[0];
    let invSubMix1 = this.invSubMix[1];
    let invSubMix2 = this.invSubMix[2];
    let invSubMix3 = this.invSubMix[3];
    let prev;
    let t;
    let ksRow;
    let invKsRow;

    for (ksRow = 0; ksRow < ksRows; ksRow++) {
      if (ksRow < keySize) {
        prev = keySchedule[ksRow] = keyWords[ksRow];
        continue;
      }
      t = prev;

      if (ksRow % keySize === 0) {
        // Rot word
        t = (t << 8) | (t >>> 24);

        // Sub word
        t = (sbox[t >>> 24] << 24) | (sbox[(t >>> 16) & 0xff] << 16) | (sbox[(t >>> 8) & 0xff] << 8) | sbox[t & 0xff];

        // Mix Rcon
        t ^= rcon[(ksRow / keySize) | 0] << 24;
      } else if (keySize > 6 && ksRow % keySize === 4)  {
        // Sub word
        t = (sbox[t >>> 24] << 24) | (sbox[(t >>> 16) & 0xff] << 16) | (sbox[(t >>> 8) & 0xff] << 8) | sbox[t & 0xff];
      }

      keySchedule[ksRow] = prev = (keySchedule[ksRow - keySize] ^ t) >>> 0;
    }

    for (invKsRow = 0; invKsRow < ksRows; invKsRow++) {
      ksRow = ksRows - invKsRow;
      if (invKsRow & 3) {
        t = keySchedule[ksRow];
      } else {
        t = keySchedule[ksRow - 4];
      }

      if (invKsRow < 4 || ksRow <= 4) {
        invKeySchedule[invKsRow] = t;
      } else {
        invKeySchedule[invKsRow] = invSubMix0[sbox[t >>> 24]] ^ invSubMix1[sbox[(t >>> 16) & 0xff]] ^ invSubMix2[sbox[(t >>> 8) & 0xff]] ^ invSubMix3[sbox[t & 0xff]];
      }

      invKeySchedule[invKsRow] = invKeySchedule[invKsRow] >>> 0;
    }
  }

  decrypt(inputData, offset, aesIV) {
    let invKeySched = this.invKeySchedule;
    let invKey0 = invKeySched[0];
    let invKey1 = invKeySched[1];
    let invKey2 = invKeySched[2];
    let invKey3 = invKeySched[3];
    let nRounds = this.keySize + 6;
    let invSubMix0 = this.invSubMix[0];
    let invSubMix1 = this.invSubMix[1];
    let invSubMix2 = this.invSubMix[2];
    let invSubMix3 = this.invSubMix[3];
    let invSBOX = this.invSBox;

    // parse iv to Uint32Array
    let iv = this.uint8ArrayToUint32Array_(aesIV);

    //let ntoh = function (word) {
    //  return (word << 24) |
    //    ((word & 0xff00) << 8) |
    //    ((word & 0xff0000) >> 8) |
    //    (word >>> 24);
    //};

    let mixing0 = iv[0];
    let mixing1 = iv[1];
    let mixing2 = iv[2];
    let mixing3 = iv[3];

    let input = new Uint8Array(inputData);

    let output = new Uint8Array(input.byteLength);

    let s = new Uint32Array(4);
    let t = new Uint32Array(4);
    let r = new Uint32Array(4);
    let resultUint8 = new Uint8Array(r.buffer);

    let w0;
    let w1;
    let w2;
    let w3;

    let ksRow;
    let i;

    //let start = Date.now();
    while (offset < inputData.byteLength) {
      w0 = input[offset + 3] | (input[offset + 2] << 8) | (input[offset + 1] << 16) | (input[offset + 0] << 24);
      w1 = input[offset + 7] | (input[offset + 6] << 8) | (input[offset + 5] << 16) | (input[offset + 4] << 24);
      w2 = input[offset + 11] | (input[offset + 10] << 8) | (input[offset + 9] << 16) | (input[offset + 8] << 24);
      w3 = input[offset + 15] | (input[offset + 14] << 8) | (input[offset + 13] << 16) | (input[offset + 12] << 24);

      s[0] = w0 ^ invKey0;
      s[1] = w3 ^ invKey1;
      s[2] = w2 ^ invKey2;
      s[3] = w1 ^ invKey3;

      ksRow = 4;

      for (i = 1; i < nRounds; i++) {
        t[0] = invSubMix0[s[0] >>> 24] ^ invSubMix1[(s[1] >>> 16) & 0xff] ^ invSubMix2[(s[2] >>> 8) & 0xff] ^ invSubMix3[s[3] & 0xff] ^ invKeySched[ksRow++];
        t[1] = invSubMix0[s[1] >>> 24] ^ invSubMix1[(s[2] >>> 16) & 0xff] ^ invSubMix2[(s[3] >>> 8) & 0xff] ^ invSubMix3[s[0] & 0xff] ^ invKeySched[ksRow++];
        t[2] = invSubMix0[s[2] >>> 24] ^ invSubMix1[(s[3] >>> 16) & 0xff] ^ invSubMix2[(s[0] >>> 8) & 0xff] ^ invSubMix3[s[1] & 0xff] ^ invKeySched[ksRow++];
        t[3] = invSubMix0[s[3] >>> 24] ^ invSubMix1[(s[0] >>> 16) & 0xff] ^ invSubMix2[(s[1] >>> 8) & 0xff] ^ invSubMix3[s[2] & 0xff] ^ invKeySched[ksRow++];
        // Update state
        s[0] = t[0];
        s[1] = t[1];
        s[2] = t[2];
        s[3] = t[3];
      }
      // Shift rows, sub bytes, add round key
      t[0] = ((invSBOX[s[0] >>> 24] << 24) | (invSBOX[(s[1] >>> 16) & 0xff] << 16) | (invSBOX[(s[2] >>> 8) & 0xff] << 8) | invSBOX[s[3] & 0xff]) ^ invKeySched[ksRow++];
      t[1] = ((invSBOX[s[1] >>> 24] << 24) | (invSBOX[(s[2] >>> 16) & 0xff] << 16) | (invSBOX[(s[3] >>> 8) & 0xff] << 8) | invSBOX[s[0] & 0xff]) ^ invKeySched[ksRow++];
      t[2] = ((invSBOX[s[2] >>> 24] << 24) | (invSBOX[(s[3] >>> 16) & 0xff] << 16) | (invSBOX[(s[0] >>> 8) & 0xff] << 8) | invSBOX[s[1] & 0xff]) ^ invKeySched[ksRow++];
      t[3] = ((invSBOX[s[3] >>> 24] << 24) | (invSBOX[(s[0] >>> 16) & 0xff] << 16) | (invSBOX[(s[1] >>> 8) & 0xff] << 8) | invSBOX[s[2] & 0xff]) ^ invKeySched[ksRow];

      r[3] = t[0] ^ mixing0;
      r[2] = t[3] ^ mixing1;
      r[1] = t[2] ^ mixing2;
      r[0] = t[1] ^ mixing3;

      for (i = 0; i < 16; i += 4) {
        output[i + offset] = resultUint8[15 - i];
        output[i + offset + 1] = resultUint8[14 - i];
        output[i + offset + 2] = resultUint8[13 - i];
        output[i + offset + 3] = resultUint8[12 - i];
      }

      // reset iv to last 4 unsigned int
      mixing0 = w0;
      mixing1 = w1;
      mixing2 = w2;
      mixing3 = w3;

      offset += 16;
    }

    //console.log('loop over', (Date.now() - start));

    return this.unpad_(output).buffer;
  }

  unpad_(data) {
    // Remove the padding at the end of output.
    // The padding occurs because each decryption happens in 16 bytes, but the encrypted data is not modulus of 16
    let len = data.length;
    let bytesOfPadding = data[len - 1];

    // Uncomment to log info about padding
    //for (let i = bytesOfPadding; i > 0; --i) {
    //    let v = data[--len];
    //
    //    if (bytesOfPadding !== v) {
    //        console.warn('Invalid padding error: Expected ' + bytesOfPadding, ', but received ' + v);
    //    }
    //}

    return data.subarray(0, data.length - bytesOfPadding);
  }
}

export default AESDecryptor;
