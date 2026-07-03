class BiquadFilter {
  constructor(type, frequency, q, sampleRate) {
    this.type = type;
    this.frequency = frequency;
    this.q = q;
    this.sampleRate = sampleRate;

    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;

    this.calculateCoefficients();
  }

  calculateCoefficients() {
    const w0 = 2 * Math.PI * this.frequency / this.sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / (2 * this.q);

    let b0;
    let b1;
    let b2;
    let a0;
    let a1;
    let a2;

    if (this.type === "highpass") {
      b0 = (1 + cosW0) / 2;
      b1 = -(1 + cosW0);
      b2 = (1 + cosW0) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosW0;
      a2 = 1 - alpha;
    }

    if (this.type === "notch") {
      b0 = 1;
      b1 = -2 * cosW0;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cosW0;
      a2 = 1 - alpha;
    }

    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  process(x) {
    const y =
      this.b0 * x +
      this.b1 * this.x1 +
      this.b2 * this.x2 -
      this.a1 * this.y1 -
      this.a2 * this.y2;

    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;

    return y;
  }

  reset() {
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;
  }
}

let noiseFilterChains = [];
let noiseGateGains = [];

function createNoiseFilterChain() {
  return [
    new BiquadFilter("highpass", 90, 0.707, SAMPLE_RATE),
    new BiquadFilter("notch", 60, 25, SAMPLE_RATE),
    new BiquadFilter("notch", 120, 25, SAMPLE_RATE)
  ];
}

function resetNoiseAttenuator() {
  noiseFilterChains = [
    createNoiseFilterChain(),
    createNoiseFilterChain()
  ];

  noiseGateGains = [1, 1];
}

function toggleNoiseAttenuator() {
  noiseAttenuatorEnabled = !noiseAttenuatorEnabled;

  noiseAttenuatorBtn.classList.toggle("noiseOn", noiseAttenuatorEnabled);

  if (noiseAttenuatorEnabled) {
    noiseAttenuatorBtn.textContent = "Noise attenuator ON";
    log("Noise attenuator enabled: high-pass + 60/120 Hz notch + soft gate.");
  } else {
    noiseAttenuatorBtn.textContent = "Noise attenuator OFF";
    log("Noise attenuator disabled.");
  }

  resetNoiseAttenuator();
}

function processNoiseAttenuator(samples, channelCount) {
  if (!noiseAttenuatorEnabled) {
    return samples;
  }

  const output = new Int16Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    const channel = channelCount === 2 ? i % 2 : 0;

    let x = samples[i] / 32768;

    const chain = noiseFilterChains[channel];

    for (let j = 0; j < chain.length; j++) {
      x = chain[j].process(x);
    }

    x = applySoftNoiseGate(x, channel);

    if (x > 1) x = 1;
    if (x < -1) x = -1;

    output[i] = Math.round(x * 32767);
  }

  return output;
}

function applySoftNoiseGate(x, channel) {
  const absX = Math.abs(x);
  const db = 20 * Math.log10(absX + 0.000001);

  let targetGain = 1;

  if (db < -48) {
    targetGain = 0.18;
  } else if (db < -40) {
    targetGain = 0.45;
  } else {
    targetGain = 1;
  }

  const currentGain = noiseGateGains[channel] || 1;

  const smoothing = targetGain < currentGain ? 0.995 : 0.92;

  const newGain =
    smoothing * currentGain +
    (1 - smoothing) * targetGain;

  noiseGateGains[channel] = newGain;

  return x * newGain;
}