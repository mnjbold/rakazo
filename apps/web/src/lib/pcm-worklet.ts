/** Source code for the PCM capture AudioWorkletProcessor, inlined as a string. */
export const PCM_WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferSize = 0;
    // Target chunk size: 2048 samples at 16kHz = 128ms. We downsample from 48kHz.
    this._targetChunkSamples = 2048;
  }
  process(inputs) {
    const input = inputs[0]?.[0]; // mono channel
    if (!input || input.length === 0) return true;
    // Downsample from currentSampleRate to 16000 by skipping samples
    const ratio = Math.round(sampleRate / 16000);
    const out = [];
    for (let i = 0; i < input.length; i += ratio) {
      out.push(input[i]);
    }
    this._buffer.push(new Float32Array(out));
    this._bufferSize += out.length;
    if (this._bufferSize >= this._targetChunkSamples) {
      // Merge buffer into single chunk
      const merged = new Float32Array(this._bufferSize);
      let offset = 0;
      for (const chunk of this._buffer) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      this._buffer = [];
      this._bufferSize = 0;
      // Convert to Int16 PCM
      const pcm = new Int16Array(merged.length);
      for (let i = 0; i < merged.length; i++) {
        const s = Math.max(-1, Math.min(1, merged[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor);
`;
