class PCMWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = [];
    this.length = 0;
    this.batchSize = Math.max(128, Math.round(sampleRate / 10));
    this.port.onmessage = event => {
      if (event.data?.type === 'flush') {
        this.flush();
        this.port.postMessage({type: 'flushed', token: event.data.token});
      }
    };
  }

  flush() {
    if (!this.length) return;
    const chunk = new Float32Array(this.length);
    let offset = 0;
    for (const part of this.pending) {
      chunk.set(part, offset);
      offset += part.length;
    }
    this.pending = [];
    this.length = 0;
    this.port.postMessage({type: 'pcm', chunk}, [chunk.buffer]);
  }

  process(inputs, outputs) {
    const channels = inputs[0];
    if (channels?.length) {
      const length = channels[0].length;
      const part = new Float32Array(length);
      for (let c = 0; c < channels.length; c++) {
        const channel = channels[c];
        for (let i = 0; i < length; i++) part[i] += channel[i] / channels.length;
      }
      this.pending.push(part);
      this.length += length;
      if (this.length >= this.batchSize) this.flush();
    }
    // Keep the processing graph active without monitoring microphone audio.
    for (const output of outputs) for (const channel of output) channel.fill(0);
    return true;
  }
}

registerProcessor('listen-pcm', PCMWorklet);
