export interface GifFrameInput {
    rgba: Uint8Array;
    delayMs: number;
}

interface ColorBox {
    rMin: number;
    rMax: number;
    gMin: number;
    gMax: number;
    bMin: number;
    bMax: number;
    count: number;
    colors: number[];
}

const HIST_SIZE = 32 * 32 * 32;

function computeBoxBounds(box: ColorBox, hist: Uint32Array): void {
    let rMin = 31;
    let rMax = 0;
    let gMin = 31;
    let gMax = 0;
    let bMin = 31;
    let bMax = 0;
    let count = 0;

    for (let i = 0; i < box.colors.length; i++) {
        const c = box.colors[i];
        const freq = hist[c];
        count += freq;
        const r = (c >> 10) & 31;
        const g = (c >> 5) & 31;
        const b = c & 31;
        if (r < rMin) rMin = r;
        if (r > rMax) rMax = r;
        if (g < gMin) gMin = g;
        if (g > gMax) gMax = g;
        if (b < bMin) bMin = b;
        if (b > bMax) bMax = b;
    }

    box.rMin = rMin;
    box.rMax = rMax;
    box.gMin = gMin;
    box.gMax = gMax;
    box.bMin = bMin;
    box.bMax = bMax;
    box.count = count;
}

/**
 * Quantizes an RGBA frame into a 256-color RGB palette (768 bytes) + indexed pixels
 * using 5-bit Median-Cut + Floyd-Steinberg dithering.
 */
export function quantizeFrameMedianCut(
    rgba: Uint8Array,
    width: number,
    height: number
): { palette: Uint8Array; indices: Uint8Array } {
    const pixelCount = width * height;
    const hist = new Uint32Array(HIST_SIZE);

    for (let i = 0; i < pixelCount; i++) {
        const off = i * 4;
        const idx5 = ((rgba[off] >> 3) << 10) | ((rgba[off + 1] >> 3) << 5) | (rgba[off + 2] >> 3);
        hist[idx5]++;
    }

    const distinct: number[] = [];
    for (let c = 0; c < HIST_SIZE; c++) {
        if (hist[c] > 0) distinct.push(c);
    }

    const palette = new Uint8Array(256 * 3);

    if (distinct.length <= 256) {
        for (let i = 0; i < distinct.length; i++) {
            const c = distinct[i];
            palette[i * 3] = ((c >> 10) & 31) * 8 + 4;
            palette[i * 3 + 1] = ((c >> 5) & 31) * 8 + 4;
            palette[i * 3 + 2] = (c & 31) * 8 + 4;
        }
    } else {
        const root: ColorBox = {
            rMin: 0,
            rMax: 31,
            gMin: 0,
            gMax: 31,
            bMin: 0,
            bMax: 31,
            count: 0,
            colors: distinct,
        };
        computeBoxBounds(root, hist);
        const boxes: ColorBox[] = [root];

        while (boxes.length < 256) {
            let bestIdx = -1;
            let bestScore = 0;
            for (let i = 0; i < boxes.length; i++) {
                const bx = boxes[i];
                if (bx.colors.length < 2) continue;
                const span = Math.max(bx.rMax - bx.rMin, bx.gMax - bx.gMin, bx.bMax - bx.bMin);
                if (span === 0) continue;
                const score = span * Math.sqrt(bx.count);
                if (score > bestScore) {
                    bestScore = score;
                    bestIdx = i;
                }
            }
            if (bestIdx === -1) break;

            const target = boxes[bestIdx];
            const rSpan = target.rMax - target.rMin;
            const gSpan = target.gMax - target.gMin;
            const bSpan = target.bMax - target.bMin;

            const channelShift = gSpan >= rSpan && gSpan >= bSpan ? 5 : rSpan >= bSpan ? 10 : 0;
            target.colors.sort((a, b) => ((a >> channelShift) & 31) - ((b >> channelShift) & 31));

            let acc = 0;
            const half = target.count >> 1;
            let splitAt = 1;
            for (let i = 0; i < target.colors.length - 1; i++) {
                acc += hist[target.colors[i]];
                if (acc >= half) {
                    splitAt = i + 1;
                    break;
                }
            }

            const leftColors = target.colors.slice(0, splitAt);
            const rightColors = target.colors.slice(splitAt);

            const leftBox: ColorBox = { ...target, colors: leftColors };
            const rightBox: ColorBox = { ...target, colors: rightColors };
            computeBoxBounds(leftBox, hist);
            computeBoxBounds(rightBox, hist);

            boxes[bestIdx] = leftBox;
            boxes.push(rightBox);
        }

        for (let i = 0; i < boxes.length; i++) {
            const bx = boxes[i];
            let rSum = 0;
            let gSum = 0;
            let bSum = 0;
            let wSum = 0;
            for (let j = 0; j < bx.colors.length; j++) {
                const c = bx.colors[j];
                const w = hist[c];
                rSum += (((c >> 10) & 31) * 8 + 4) * w;
                gSum += (((c >> 5) & 31) * 8 + 4) * w;
                bSum += ((c & 31) * 8 + 4) * w;
                wSum += w;
            }
            if (wSum > 0) {
                palette[i * 3] = Math.round(rSum / wSum);
                palette[i * 3 + 1] = Math.round(gSum / wSum);
                palette[i * 3 + 2] = Math.round(bSum / wSum);
            }
        }
    }

    const paletteCount = Math.min(256, Math.max(1, distinct.length));
    const lut = new Int16Array(HIST_SIZE);
    lut.fill(-1);

    const nearestPaletteIndex = (r: number, g: number, b: number): number => {
        const idx5 = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        const cached = lut[idx5];
        if (cached >= 0) return cached;

        const rMid = (r & 0xf8) + 4;
        const gMid = (g & 0xf8) + 4;
        const bMid = (b & 0xf8) + 4;
        let best = 0;
        let bestDist = Number.MAX_SAFE_INTEGER;
        for (let i = 0; i < paletteCount; i++) {
            const pOff = i * 3;
            const dr = palette[pOff] - rMid;
            const dg = palette[pOff + 1] - gMid;
            const db = palette[pOff + 2] - bMid;
            const d = dr * dr * 3 + dg * dg * 4 + db * db * 2;
            if (d < bestDist) {
                bestDist = d;
                best = i;
                if (d === 0) break;
            }
        }
        lut[idx5] = best;
        return best;
    };

    // Light Floyd-Steinberg error diffusion (75% strength prevents speckle in dark HUD bars)
    const indices = new Uint8Array(pixelCount);
    let curErrR = new Int16Array(width + 2);
    let curErrG = new Int16Array(width + 2);
    let curErrB = new Int16Array(width + 2);
    let nxtErrR = new Int16Array(width + 2);
    let nxtErrG = new Int16Array(width + 2);
    let nxtErrB = new Int16Array(width + 2);

    for (let y = 0; y < height; y++) {
        nxtErrR.fill(0);
        nxtErrG.fill(0);
        nxtErrB.fill(0);
        const rowOff = y * width;

        for (let x = 0; x < width; x++) {
            const pxIdx = rowOff + x;
            const rgbaOff = pxIdx * 4;
            const r = Math.max(0, Math.min(255, rgba[rgbaOff] + (curErrR[x + 1] >> 4)));
            const g = Math.max(0, Math.min(255, rgba[rgbaOff + 1] + (curErrG[x + 1] >> 4)));
            const b = Math.max(0, Math.min(255, rgba[rgbaOff + 2] + (curErrB[x + 1] >> 4)));

            const pIdx = nearestPaletteIndex(r, g, b);
            indices[pxIdx] = pIdx;

            const pOff = pIdx * 3;
            const er = ((r - palette[pOff]) * 3) >> 2;
            const eg = ((g - palette[pOff + 1]) * 3) >> 2;
            const eb = ((b - palette[pOff + 2]) * 3) >> 2;

            curErrR[x + 2] += er * 7;
            curErrG[x + 2] += eg * 7;
            curErrB[x + 2] += eb * 7;

            nxtErrR[x] += er * 3;
            nxtErrG[x] += eg * 3;
            nxtErrB[x] += eb * 3;

            nxtErrR[x + 1] += er * 5;
            nxtErrG[x + 1] += eg * 5;
            nxtErrB[x + 1] += eb * 5;

            nxtErrR[x + 2] += er;
            nxtErrG[x + 2] += eg;
            nxtErrB[x + 2] += eb;
        }

        const tmpR = curErrR;
        curErrR = nxtErrR;
        nxtErrR = tmpR;
        const tmpG = curErrG;
        curErrG = nxtErrG;
        nxtErrG = tmpG;
        const tmpB = curErrB;
        curErrB = nxtErrB;
        nxtErrB = tmpB;
    }

    return { palette, indices };
}

function lzwEncodeIndices(indices: Uint8Array): Uint8Array {
    const clearCode = 256;
    const eoiCode = 257;

    const dictNext = new Int32Array(4096 * 256);
    const dictGen = new Int32Array(4096 * 256);
    let gen = 1;

    const bytes: number[] = [];
    let bitBuf = 0;
    let bitCount = 0;

    const writeCode = (code: number, size: number) => {
        bitBuf |= code << bitCount;
        bitCount += size;
        while (bitCount >= 8) {
            bytes.push(bitBuf & 0xff);
            bitBuf >>= 8;
            bitCount -= 8;
        }
    };

    let codeSize = 9;
    let nextCode = 258;
    writeCode(clearCode, codeSize);

    if (indices.length === 0) {
        writeCode(eoiCode, codeSize);
        if (bitCount > 0) bytes.push(bitBuf & 0xff);
        return Uint8Array.from(bytes);
    }

    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
        const k = indices[i];
        const slot = (prefix << 8) | k;
        if (dictGen[slot] === gen) {
            prefix = dictNext[slot];
        } else {
            writeCode(prefix, codeSize);
            if (nextCode < 4096) {
                dictGen[slot] = gen;
                dictNext[slot] = nextCode;
                if (nextCode === 1 << codeSize && codeSize < 12) {
                    codeSize++;
                }
                nextCode++;
            } else {
                writeCode(clearCode, codeSize);
                gen++;
                codeSize = 9;
                nextCode = 258;
            }
            prefix = k;
        }
    }

    writeCode(prefix, codeSize);
    writeCode(eoiCode, codeSize);
    if (bitCount > 0) {
        bytes.push(bitBuf & 0xff);
    }

    // Wrap into <=255-byte GIF sub-blocks + 0x00 terminator
    const out: number[] = [8]; // LZW minimum code size = 8
    let offset = 0;
    while (offset < bytes.length) {
        const chunkLen = Math.min(255, bytes.length - offset);
        out.push(chunkLen);
        for (let j = 0; j < chunkLen; j++) {
            out.push(bytes[offset + j]);
        }
        offset += chunkLen;
    }
    out.push(0); // Block terminator
    return Uint8Array.from(out);
}

/**
 * Encodes RGBA frames into an infinitely looping GIF89a buffer, yielding to the
 * Node event loop between frames so Discord gateway heartbeats never stall.
 */
export async function encodeAnimatedGifAsync(
    frames: GifFrameInput[],
    width: number,
    height: number
): Promise<Buffer> {
    if (frames.length === 0) {
        throw new Error('encodeAnimatedGifAsync requires at least one frame');
    }

    const quantized: Array<{ palette: Uint8Array; lzw: Uint8Array; delayCs: number }> = [];
    for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        if (f.rgba.length !== width * height * 4) {
            throw new Error(
                `Frame ${i} RGBA length ${f.rgba.length} does not match ${width}x${height}x4`
            );
        }
        const { palette, indices } = quantizeFrameMedianCut(f.rgba, width, height);
        const lzw = lzwEncodeIndices(indices);
        const delayCs = Math.max(2, Math.round(f.delayMs / 10));
        quantized.push({ palette, lzw, delayCs });
        await new Promise<void>(resolve => setImmediate(resolve));
    }

    const chunks: Buffer[] = [];

    // Header + Logical Screen Descriptor using Frame 0's 256-color palette as GCT
    const header = Buffer.alloc(13);
    header.write('GIF89a', 0, 'ascii');
    header.writeUInt16LE(width, 6);
    header.writeUInt16LE(height, 8);
    header[10] = 0xf7; // GCT present (1), 8-bit color res (7), unsorted (0), 256 entries (7)
    header[11] = 0;
    header[12] = 0;
    chunks.push(header);
    chunks.push(Buffer.from(quantized[0].palette));

    // Netscape 2.0 infinite-loop extension
    chunks.push(
        Buffer.from([
            0x21, 0xff, 0x0b,
            0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30,
            0x03, 0x01, 0x00, 0x00, 0x00,
        ])
    );

    for (let i = 0; i < quantized.length; i++) {
        const q = quantized[i];
        const gce = Buffer.alloc(8);
        gce[0] = 0x21;
        gce[1] = 0xf9;
        gce[2] = 0x04;
        gce[3] = 0x04; // Disposal 1 (do not dispose), no transparency
        gce.writeUInt16LE(q.delayCs, 4);
        gce[6] = 0;
        gce[7] = 0;
        chunks.push(gce);

        const imgDesc = Buffer.alloc(10);
        imgDesc[0] = 0x2c;
        imgDesc.writeUInt16LE(0, 1);
        imgDesc.writeUInt16LE(0, 3);
        imgDesc.writeUInt16LE(width, 5);
        imgDesc.writeUInt16LE(height, 7);
        if (i === 0) {
            imgDesc[9] = 0x00; // Use Global Color Table
            chunks.push(imgDesc);
        } else {
            imgDesc[9] = 0x87; // Local Color Table, 256 entries
            chunks.push(imgDesc);
            chunks.push(Buffer.from(q.palette));
        }

        chunks.push(Buffer.from(q.lzw));
    }

    chunks.push(Buffer.from([0x3b])); // GIF trailer
    return Buffer.concat(chunks);
}
