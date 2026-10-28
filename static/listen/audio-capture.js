/** Microphone PCM capture. Audio never leaves the current browser page. */
function withTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  })]).finally(() => clearTimeout(timer));
}

export class CaptureSession {
  constructor({onLevel = () => {}, onChunk = () => {}, maxBufferSeconds = 20} = {}) {
    this.onLevel = onLevel;
    this.onChunk = onChunk;
    this.maxBufferSeconds = maxBufferSeconds;
    this.epoch = 0;
    this.chunks = [];
    this.samples = 0;
    this.totalSamples = 0;
    this.active = false;
  }

  async start() {
    if (this.active) throw new Error('Microphone is already recording.');
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext ||
        (!window.AudioWorkletNode && !window.AudioContext.prototype.createScriptProcessor)) {
      throw new Error('This browser cannot record microphone audio here. Try a current browser over HTTPS or localhost.');
    }
    const epoch = ++this.epoch;
    this.chunks = [];
    this.samples = 0;
    this.totalSamples = 0;
    let stream;
    let context;
    try {
      const request = navigator.mediaDevices.getUserMedia({audio: {
        channelCount: {ideal: 1}, echoCancellation: false,
        noiseSuppression: false, autoGainControl: false,
      }, video: false});
      request.then(lateStream => {
        if (epoch !== this.epoch) lateStream.getTracks().forEach(track => track.stop());
      }).catch(() => {});
      stream = await withTimeout(request, 30000, 'Microphone permission timed out. Please try again.');
      if (epoch !== this.epoch) {
        stream.getTracks().forEach(track => track.stop());
        throw new Error('Recording was cancelled.');
      }
      context = new AudioContext({latencyHint: 'interactive'});
      if (epoch !== this.epoch) throw new Error('Recording was cancelled.');
      const source = context.createMediaStreamSource(stream);
      let node;
      if (window.AudioWorkletNode && context.audioWorklet) {
        try {
          await withTimeout(context.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url)),
            3000, 'AudioWorklet did not start.');
          if (epoch !== this.epoch) throw new Error('Recording was cancelled.');
          node = new AudioWorkletNode(context, 'listen-pcm', {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
          });
          node.port.onmessage = event => this.handleMessage(event.data, epoch);
        } catch (error) {
          if (epoch !== this.epoch || !context.createScriptProcessor) throw error;
        }
      }
      if (!node) {
        node = context.createScriptProcessor(2048, 1, 1);
        node.onaudioprocess = event => {
          const input = event.inputBuffer;
          const chunk = new Float32Array(input.length);
          for (let channel = 0; channel < input.numberOfChannels; channel++) {
            const samples = input.getChannelData(channel);
            for (let i = 0; i < chunk.length; i++) chunk[i] += samples[i] / input.numberOfChannels;
          }
          event.outputBuffer.getChannelData(0).fill(0);
          this.handleMessage({type: 'pcm', chunk}, epoch);
        };
      }
      this.sampleRate = context.sampleRate;
      source.connect(node);
      node.connect(context.destination);
      await withTimeout(context.resume(), 10000,
        'Microphone audio processing could not start. Please try another browser.');
      if (epoch !== this.epoch) throw new Error('Recording was cancelled.');
      this.stream = stream;
      this.context = context;
      this.source = source;
      this.node = node;
      this.active = true;
      return {sampleRate: this.sampleRate};
    } catch (error) {
      ++this.epoch;
      stream?.getTracks().forEach(track => track.stop());
      if (context) await withTimeout(context.close(), 2000,
        'Audio cleanup timed out.').catch(() => {});
      throw error;
    }
  }

  handleMessage(message, epoch) {
    if (epoch !== this.epoch) return;
    if (message?.type === 'flushed') {
      if (this.flushResolve && message.token === this.flushToken) {
        this.flushResolve();
        this.flushResolve = null;
      }
      return;
    }
    if (message?.type !== 'pcm' || !(message.chunk instanceof Float32Array)) return;
    const chunk = message.chunk;
    this.totalSamples += chunk.length;
    let sum = 0, peak = 0;
    for (const x of chunk) { sum += x * x; peak = Math.max(peak, Math.abs(x)); }
    this.onLevel({rms: Math.sqrt(sum / Math.max(1, chunk.length)), peak,
      elapsedSeconds: this.totalSamples / this.sampleRate});
    this.onChunk(chunk, this.sampleRate, this.totalSamples / this.sampleRate);
    this.chunks.push(chunk);
    this.samples += chunk.length;
    const limit = Math.ceil(this.maxBufferSeconds * this.sampleRate);
    while (this.samples > limit && this.chunks.length > 1) {
      this.samples -= this.chunks.shift().length;
    }
  }

  async stop() {
    if (!this.active) return {pcm: new Float32Array(), sampleRate: this.sampleRate || 0,
      durationSeconds: 0};
    if (this.node.port) {
      const token = ++this.flushToken || (this.flushToken = 1);
      await new Promise(resolve => {
        this.flushResolve = resolve;
        this.node.port.postMessage({type: 'flush', token});
        setTimeout(resolve, 250);
      });
    }
    const pcm = new Float32Array(this.samples);
    let offset = 0;
    for (const chunk of this.chunks) { pcm.set(chunk, offset); offset += chunk.length; }
    const sampleRate = this.sampleRate;
    await this.close();
    return {pcm, sampleRate, durationSeconds: pcm.length / sampleRate};
  }

  snapshot(maxSeconds = this.maxBufferSeconds) {
    if (!this.sampleRate) return {pcm: new Float32Array(), sampleRate: 0,
      durationSeconds: 0, startSeconds: 0};
    const wanted = Math.min(this.samples, Math.ceil(maxSeconds * this.sampleRate));
    const pcm = new Float32Array(wanted);
    let remaining = wanted;
    for (let i = this.chunks.length - 1; i >= 0 && remaining; i--) {
      const chunk = this.chunks[i];
      const count = Math.min(chunk.length, remaining);
      pcm.set(chunk.subarray(chunk.length - count), remaining - count);
      remaining -= count;
    }
    return {pcm, sampleRate: this.sampleRate, durationSeconds: wanted / this.sampleRate,
      startSeconds: (this.totalSamples - wanted) / this.sampleRate};
  }

  async close() {
    ++this.epoch;
    this.active = false;
    this.flushResolve?.();
    this.flushResolve = null;
    this.stream?.getTracks().forEach(track => track.stop());
    if (this.node && 'onaudioprocess' in this.node) this.node.onaudioprocess = null;
    this.node?.disconnect();
    this.source?.disconnect();
    this.node?.port?.close();
    if (this.context && this.context.state !== 'closed') await withTimeout(this.context.close(),
      2000, 'Audio cleanup timed out.').catch(() => {});
    this.stream = this.node = this.source = this.context = null;
    this.chunks = [];
    this.samples = 0;
  }
}
