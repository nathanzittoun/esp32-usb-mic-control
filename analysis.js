function dbfs(value) {
  if (value <= 0) {
    return -120;
  }

  return 20 * Math.log10(value / 32768);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dbToBar(db) {
  return clamp(((db + 80) / 80) * 100, 0, 100);
}

function goertzelMagnitude(samples, targetFreq, sampleRate) {
  const n = samples.length;

  if (n === 0) {
    return 0;
  }

  const k = Math.round((n * targetFreq) / sampleRate);
  const omega = (2 * Math.PI * k) / n;
  const coeff = 2 * Math.cos(omega);

  let s0 = 0;
  let s1 = 0;
  let s2 = 0;

  for (let i = 0; i < n; i++) {
    s0 = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }

  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;

  return Math.sqrt(Math.max(power, 0)) / n;
}

function calculateRumbleIndex(samples) {
  if (samples.length < 20) {
    return 0;
  }

  let slowEnergy = 0;
  let totalEnergy = 0;
  let smooth = samples[0];

  for (let i = 1; i < samples.length; i++) {
    smooth = 0.98 * smooth + 0.02 * samples[i];

    slowEnergy += Math.abs(smooth);
    totalEnergy += Math.abs(samples[i]);
  }

  if (totalEnergy === 0) {
    return 0;
  }

  return clamp(slowEnergy / totalEnergy, 0, 1);
}

function updateNoiseIndicators(samples) {
  if (!samples || samples.length === 0) {
    return;
  }

  let sumSquares = 0;
  let peak = 0;
  let clipped = 0;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const absS = Math.abs(s);

    sumSquares += s * s;

    if (absS > peak) {
      peak = absS;
    }

    if (absS > 32000) {
      clipped++;
    }
  }

  const rms = Math.sqrt(sumSquares / samples.length);
  const rmsDb = dbfs(rms);
  const peakDb = dbfs(peak);
  const clippingPercent = (clipped / samples.length) * 100;

  const hum60Mag = goertzelMagnitude(samples, 60, SAMPLE_RATE);
  const hum120Mag = goertzelMagnitude(samples, 120, SAMPLE_RATE);

  const hum60Db = dbfs(hum60Mag);
  const hum120Db = dbfs(hum120Mag);

  const rumbleIndex = calculateRumbleIndex(samples);

  rmsDbEl.textContent = rmsDb.toFixed(1) + " dBFS";
  peakDbEl.textContent = peakDb.toFixed(1) + " dBFS";
  clipPercentEl.textContent = clippingPercent.toFixed(2) + "%";

  hum60El.textContent = hum60Db.toFixed(1) + " dB";
  hum120El.textContent = hum120Db.toFixed(1) + " dB";
  rumbleLevelEl.textContent = Math.round(rumbleIndex * 100) + "%";

  rmsBar.style.width = dbToBar(rmsDb) + "%";
  peakBar.style.width = dbToBar(peakDb) + "%";
  clipBar.style.width = clamp(clippingPercent * 20, 0, 100) + "%";
  hum60Bar.style.width = dbToBar(hum60Db) + "%";
  hum120Bar.style.width = dbToBar(hum120Db) + "%";
  rumbleBar.style.width = clamp(rumbleIndex * 100, 0, 100) + "%";

  if (calibratedNoiseFloorDb !== null) {
    const aboveNoise = rmsDb - calibratedNoiseFloorDb;

    noiseFloorEl.textContent = calibratedNoiseFloorDb.toFixed(1) + " dBFS baseline";

    if (aboveNoise < 3) {
      noiseCommentEl.textContent = "Current input is near the calibrated noise floor.";
    } else if (aboveNoise < 10) {
      noiseCommentEl.textContent = "Current input is slightly above the noise floor.";
    } else {
      noiseCommentEl.textContent = "Current input is clearly above the noise floor.";
    }
  }

  if (clippingPercent > 0.5) {
    noiseCommentEl.textContent = "Clipping detected. Increase PCM_SHIFT in Arduino code to reduce gain.";
  } else if (hum60Db > -35 || hum120Db > -35) {
    noiseCommentEl.textContent = "Strong 60/120 Hz component detected. Possible electrical hum or power noise.";
  } else if (rumbleIndex > 0.75 && rmsDb > -40) {
    noiseCommentEl.textContent = "Low-frequency movement may be present. Check for handling noise or vibration.";
  }
}

function calibrateNoiseFloor() {
  if (liveSamples.length < SAMPLE_RATE * 0.5) {
    noiseFloorEl.textContent = "Need more silence";
    noiseCommentEl.textContent = "Record at least 1 second of quiet audio, then calibrate.";
    return;
  }

  let sumSquares = 0;

  for (let i = 0; i < liveSamples.length; i++) {
    sumSquares += liveSamples[i] * liveSamples[i];
  }

  const rms = Math.sqrt(sumSquares / liveSamples.length);
  calibratedNoiseFloorDb = dbfs(rms);

  noiseFloorEl.textContent = calibratedNoiseFloorDb.toFixed(1) + " dBFS baseline";
  noiseCommentEl.textContent = "Noise floor calibrated. Now compare speech or silence against it.";

  log("Noise floor calibrated: " + calibratedNoiseFloorDb.toFixed(1) + " dBFS");
}

function drawSpectrumBackground(minFreq = 0, maxFreq = SAMPLE_RATE / 2) {
  spectrumCtx.fillStyle = "#f0f0f2";
  spectrumCtx.fillRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);

  spectrumCtx.strokeStyle = "#d8d8dc";
  spectrumCtx.lineWidth = 1;

  for (let i = 0; i <= 5; i++) {
    const y = (spectrumCanvas.height / 5) * i;

    spectrumCtx.beginPath();
    spectrumCtx.moveTo(0, y);
    spectrumCtx.lineTo(spectrumCanvas.width, y);
    spectrumCtx.stroke();

    const db = 0 - i * 20;
    spectrumCtx.fillStyle = "#7a7a7d";
    spectrumCtx.font = "12px -apple-system, BlinkMacSystemFont, Arial";
    spectrumCtx.fillText(db + " dB", 8, y + 14);
  }

  for (let i = 0; i <= 8; i++) {
    const x = (spectrumCanvas.width / 8) * i;
    const freq = Math.round(minFreq + (maxFreq - minFreq) * (i / 8));

    spectrumCtx.beginPath();
    spectrumCtx.moveTo(x, 0);
    spectrumCtx.lineTo(x, spectrumCanvas.height);
    spectrumCtx.stroke();

    spectrumCtx.fillStyle = "#7a7a7d";
    spectrumCtx.font = "12px -apple-system, BlinkMacSystemFont, Arial";
    spectrumCtx.fillText(freq + " Hz", x + 6, spectrumCanvas.height - 10);
  }
}

function nextPowerOfTwo(value) {
  let power = 1;

  while (power < value) {
    power *= 2;
  }

  return power;
}

function hannWindow(n, N) {
  return 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
}

function fftRadix2(real, imag) {
  const n = real.length;

  let j = 0;

  for (let i = 1; i < n; i++) {
    let bit = n >> 1;

    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }

    j ^= bit;

    if (i < j) {
      const tempReal = real[i];
      const tempImag = imag[i];

      real[i] = real[j];
      imag[i] = imag[j];

      real[j] = tempReal;
      imag[j] = tempImag;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * Math.PI / len;
    const wLenReal = Math.cos(angle);
    const wLenImag = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wReal = 1;
      let wImag = 0;

      for (let k = 0; k < len / 2; k++) {
        const uReal = real[i + k];
        const uImag = imag[i + k];

        const vReal =
          real[i + k + len / 2] * wReal -
          imag[i + k + len / 2] * wImag;

        const vImag =
          real[i + k + len / 2] * wImag +
          imag[i + k + len / 2] * wReal;

        real[i + k] = uReal + vReal;
        imag[i + k] = uImag + vImag;

        real[i + k + len / 2] = uReal - vReal;
        imag[i + k + len / 2] = uImag - vImag;

        const nextWReal = wReal * wLenReal - wImag * wLenImag;
        const nextWImag = wReal * wLenImag + wImag * wLenReal;

        wReal = nextWReal;
        wImag = nextWImag;
      }
    }
  }
}

function computeSpectrum(samples) {
  if (!samples || samples.length < 512) {
    return null;
  }

  const N = Math.min(FFT_SIZE, nextPowerOfTwo(samples.length));

  if (N < 512) {
    return null;
  }

  const hopSize = Math.floor(N / 2);
  const binCount = Math.floor(N / 2);

  const accumulatedMagnitude = new Float64Array(binCount);
  const frequencies = new Float32Array(binCount);

  for (let k = 0; k < binCount; k++) {
    frequencies[k] = (k * SAMPLE_RATE) / N;
  }

  let frameCounter = 0;

  if (samples.length <= N) {
    accumulateFftFrame(samples, 0, N, accumulatedMagnitude);
    frameCounter = 1;
  } else {
    for (let start = 0; start + N <= samples.length; start += hopSize) {
      accumulateFftFrame(samples, start, N, accumulatedMagnitude);
      frameCounter++;
    }
  }

  if (frameCounter === 0) {
    return null;
  }

  const magnitudes = new Float32Array(binCount);

  for (let k = 0; k < binCount; k++) {
    const avgMag = accumulatedMagnitude[k] / frameCounter;
    magnitudes[k] = 20 * Math.log10(avgMag / 32768 + 1e-12);
  }

  return {
    frequencies,
    magnitudes,
    fftSize: N,
    sampleRate: SAMPLE_RATE,
    averagedFrames: frameCounter
  };
}

function accumulateFftFrame(samples, start, N, accumulatedMagnitude) {
  const real = new Float32Array(N);
  const imag = new Float32Array(N);

  let mean = 0;

  for (let i = 0; i < N; i++) {
    const index = start + i;
    const value = index < samples.length ? samples[index] : 0;
    mean += value;
  }

  mean /= N;

  for (let i = 0; i < N; i++) {
    const index = start + i;
    const value = index < samples.length ? samples[index] : 0;

    real[i] = (value - mean) * hannWindow(i, N);
    imag[i] = 0;
  }

  fftRadix2(real, imag);

  const binCount = Math.floor(N / 2);

  for (let k = 0; k < binCount; k++) {
    const mag = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]) / N;
    accumulatedMagnitude[k] += mag;
  }
}

function getFullAnalysisSource() {
  const sourceValue = analysisSourceSelect.value;

  if (sourceValue === "live") {
    return {
      name: "live_buffer",
      samples: Int16Array.from(liveSamples)
    };
  }

  const recordingId = Number(sourceValue.replace("recording-", ""));
  const recording = recordings.find(r => r.id === recordingId);

  if (!recording) {
    return null;
  }

  return {
    name: "recording_" + recording.number + "_" + recording.mode,
    samples: recording.analysisSamples
  };
}

function getSelectedAnalysisSamples() {
  const source = getFullAnalysisSource();

  if (!source || source.samples.length < 2) {
    return null;
  }

  const total = source.samples.length;

  let startIndex = Math.floor(analysisSelectionStart * total);
  let endIndex = Math.floor(analysisSelectionEnd * total);

  startIndex = clamp(startIndex, 0, total - 1);
  endIndex = clamp(endIndex, startIndex + 1, total);

  const selected = source.samples.slice(startIndex, endIndex);

  return {
    name: source.name + "_selected_" + startIndex + "_" + endIndex,
    samples: selected,
    fullSamples: source.samples,
    startIndex,
    endIndex
  };
}

function getAnalysisSamples() {
  return getSelectedAnalysisSamples();
}

function resetAnalysisSelection() {
  analysisSelectionStart = 0;
  analysisSelectionEnd = 1;
  analysisDragMode = null;
  drawAnalysisWaveform();
}

function drawAnalysisWaveform() {
  if (!analysisWaveformCanvas || !analysisWaveformCtx) {
    return;
  }

  const source = getFullAnalysisSource();

  analysisWaveformCtx.fillStyle = "#f0f0f2";
  analysisWaveformCtx.fillRect(
    0,
    0,
    analysisWaveformCanvas.width,
    analysisWaveformCanvas.height
  );

  analysisWaveformCtx.strokeStyle = "#d8d8dc";
  analysisWaveformCtx.lineWidth = 1;

  for (let i = 0; i <= 4; i++) {
    const y = (analysisWaveformCanvas.height / 4) * i;
    analysisWaveformCtx.beginPath();
    analysisWaveformCtx.moveTo(0, y);
    analysisWaveformCtx.lineTo(analysisWaveformCanvas.width, y);
    analysisWaveformCtx.stroke();
  }

  const midY = analysisWaveformCanvas.height / 2;

  analysisWaveformCtx.strokeStyle = "#b8b8bd";
  analysisWaveformCtx.beginPath();
  analysisWaveformCtx.moveTo(0, midY);
  analysisWaveformCtx.lineTo(analysisWaveformCanvas.width, midY);
  analysisWaveformCtx.stroke();

  if (!source || source.samples.length < 2) {
    selectedRangeLabel.textContent = "No waveform available";
    return;
  }

  const samples = source.samples;
  const width = analysisWaveformCanvas.width;
  const height = analysisWaveformCanvas.height;

  analysisWaveformCtx.strokeStyle = "#b31b1b";
  analysisWaveformCtx.lineWidth = 1.5;
  analysisWaveformCtx.beginPath();

  for (let x = 0; x < width; x++) {
    const start = Math.floor((x / width) * samples.length);
    const end = Math.floor(((x + 1) / width) * samples.length);

    let min = 32767;
    let max = -32768;

    for (let i = start; i < end && i < samples.length; i++) {
      const v = samples[i];

      if (v < min) min = v;
      if (v > max) max = v;
    }

    if (min === 32767 && max === -32768) {
      min = 0;
      max = 0;
    }

    const yMin = midY - (min / 32768) * height * 0.42;
    const yMax = midY - (max / 32768) * height * 0.42;

    analysisWaveformCtx.moveTo(x, yMin);
    analysisWaveformCtx.lineTo(x, yMax);
  }

  analysisWaveformCtx.stroke();

  drawSelectionOverlay(source.samples.length);
}

function drawSelectionOverlay(totalSamples) {
  const width = analysisWaveformCanvas.width;
  const height = analysisWaveformCanvas.height;

  const x1 = analysisSelectionStart * width;
  const x2 = analysisSelectionEnd * width;

  analysisWaveformCtx.fillStyle = "rgba(179, 27, 27, 0.16)";
  analysisWaveformCtx.fillRect(x1, 0, x2 - x1, height);

  analysisWaveformCtx.fillStyle = "rgba(0, 0, 0, 0.10)";
  analysisWaveformCtx.fillRect(0, 0, x1, height);
  analysisWaveformCtx.fillRect(x2, 0, width - x2, height);

  analysisWaveformCtx.strokeStyle = "#1d1d1f";
  analysisWaveformCtx.lineWidth = 3;

  analysisWaveformCtx.beginPath();
  analysisWaveformCtx.moveTo(x1, 0);
  analysisWaveformCtx.lineTo(x1, height);
  analysisWaveformCtx.stroke();

  analysisWaveformCtx.beginPath();
  analysisWaveformCtx.moveTo(x2, 0);
  analysisWaveformCtx.lineTo(x2, height);
  analysisWaveformCtx.stroke();

  analysisWaveformCtx.fillStyle = "#1d1d1f";
  analysisWaveformCtx.fillRect(x1 - 5, height / 2 - 22, 10, 44);
  analysisWaveformCtx.fillRect(x2 - 5, height / 2 - 22, 10, 44);

  const startSec = (analysisSelectionStart * totalSamples) / SAMPLE_RATE;
  const endSec = (analysisSelectionEnd * totalSamples) / SAMPLE_RATE;
  const durationSec = endSec - startSec;

  selectedRangeLabel.textContent =
    startSec.toFixed(2) +
    "–" +
    endSec.toFixed(2) +
    " s · " +
    durationSec.toFixed(2) +
    " s selected";
}

function getAnalysisWaveformMousePosition(event) {
  const rect = analysisWaveformCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  return clamp(x / rect.width, 0, 1);
}

let analysisDragOffset = 0;

function beginAnalysisSelectionDrag(event) {
  const pos = getAnalysisWaveformMousePosition(event);

  const leftDistance = Math.abs(pos - analysisSelectionStart);
  const rightDistance = Math.abs(pos - analysisSelectionEnd);

  const handleTolerance = 0.025;

  if (leftDistance < handleTolerance) {
    analysisDragMode = "left";
  } else if (rightDistance < handleTolerance) {
    analysisDragMode = "right";
  } else if (pos > analysisSelectionStart && pos < analysisSelectionEnd) {
    analysisDragMode = "middle";
    analysisDragOffset = pos - analysisSelectionStart;
  } else {
    const width = analysisSelectionEnd - analysisSelectionStart;

    analysisSelectionStart = clamp(pos, 0, 1 - width);
    analysisSelectionEnd = analysisSelectionStart + width;

    analysisDragMode = "middle";
    analysisDragOffset = pos - analysisSelectionStart;

    drawAnalysisWaveform();
    plotNoiseSpectrum();
  }
}

function moveAnalysisSelectionDrag(event) {
  if (!analysisDragMode) {
    return;
  }

  const pos = getAnalysisWaveformMousePosition(event);
  const minWidth = 512 / getCurrentAnalysisSampleCount();

  if (analysisDragMode === "left") {
    analysisSelectionStart = clamp(pos, 0, analysisSelectionEnd - minWidth);
  }

  if (analysisDragMode === "right") {
    analysisSelectionEnd = clamp(pos, analysisSelectionStart + minWidth, 1);
  }

  if (analysisDragMode === "middle") {
    const width = analysisSelectionEnd - analysisSelectionStart;
    let newStart = pos - analysisDragOffset;

    newStart = clamp(newStart, 0, 1 - width);

    analysisSelectionStart = newStart;
    analysisSelectionEnd = newStart + width;
  }

  drawAnalysisWaveform();
  plotNoiseSpectrum();
}

function endAnalysisSelectionDrag() {
  analysisDragMode = null;
}

function getCurrentAnalysisSampleCount() {
  const source = getFullAnalysisSource();

  if (!source || !source.samples) {
    return SAMPLE_RATE;
  }

  return source.samples.length;
}

function initAnalysisWaveformSelection() {
  if (!analysisWaveformCanvas) {
    return;
  }

  analysisWaveformCanvas.addEventListener("mousedown", event => {
    beginAnalysisSelectionDrag(event);
  });

  window.addEventListener("mousemove", event => {
    moveAnalysisSelectionDrag(event);
  });

  window.addEventListener("mouseup", () => {
    endAnalysisSelectionDrag();
  });

  analysisWaveformCanvas.addEventListener("touchstart", event => {
    if (event.touches.length > 0) {
      beginAnalysisSelectionDrag(event.touches[0]);
    }
  });

  window.addEventListener("touchmove", event => {
    if (event.touches.length > 0) {
      moveAnalysisSelectionDrag(event.touches[0]);
    }
  });

  window.addEventListener("touchend", () => {
    endAnalysisSelectionDrag();
  });
}

function findDominantFrequencies(spectrum, minFreq, maxFreq) {
  const peaks = [];

  for (let i = 2; i < spectrum.magnitudes.length - 2; i++) {
    const freq = spectrum.frequencies[i];
    const db = spectrum.magnitudes[i];

    if (freq < minFreq || freq > maxFreq || freq < 20) {
      continue;
    }

    const isLocalPeak =
      db > spectrum.magnitudes[i - 1] &&
      db > spectrum.magnitudes[i + 1] &&
      db > spectrum.magnitudes[i - 2] &&
      db > spectrum.magnitudes[i + 2];

    if (isLocalPeak) {
      peaks.push({
        freq,
        db
      });
    }
  }

  peaks.sort((a, b) => b.db - a.db);

  if (peaks.length === 0) {
    return [];
  }

  const strongestDb = peaks[0].db;

  return peaks
    .filter(p => p.db >= strongestDb - 35 && p.db > -110)
    .slice(0, 10);
}

function interpretSpectrum(peaks) {
  if (!peaks || peaks.length === 0) {
    return "No clear dominant peaks detected in this selected region.";
  }

  const peakFreqs = peaks.map(p => p.freq);
  const has60 = peakFreqs.some(f => Math.abs(f - 60) < 8);
  const has120 = peakFreqs.some(f => Math.abs(f - 120) < 10);
  const hasLow = peakFreqs.some(f => f < 150);
  const hasHigh = peakFreqs.some(f => f > 3000);

  const messages = [];

  if (has60) {
    messages.push("Peak near 60 Hz: possible electrical hum or USB/power noise.");
  }

  if (has120) {
    messages.push("Peak near 120 Hz: possible power harmonic.");
  }

  if (hasLow) {
    messages.push("Low-frequency peaks: possible rumble, vibration, handling, or environmental noise.");
  }

  if (hasHigh) {
    messages.push("High-frequency peaks: possible hiss, digital artifact, or sharp acoustic source.");
  }

  if (messages.length === 0) {
    messages.push("Peaks are present, but none match the usual 60/120 Hz or low-rumble patterns.");
  }

  return messages.join(" ");
}

function plotNoiseSpectrum() {
  drawAnalysisWaveform();

  const source = getAnalysisSamples();

  if (!source || source.samples.length < 1024) {
    dominantFrequenciesEl.textContent = "Need more samples. Select a larger waveform region.";
    fftInterpretationEl.textContent = "Drag the waveform boundaries to select more audio.";
    return;
  }

  const minFreq = clamp(Number(fftMinFreqInput.value) || 0, 0, SAMPLE_RATE / 2);
  const maxFreq = clamp(
    Number(fftMaxFreqInput.value) || SAMPLE_RATE / 2,
    minFreq + 10,
    SAMPLE_RATE / 2
  );

  fftMinFreqInput.value = Math.round(minFreq);
  fftMaxFreqInput.value = Math.round(maxFreq);
  fftRangeLabel.textContent = Math.round(minFreq) + "–" + Math.round(maxFreq) + " Hz";

  const spectrum = computeSpectrum(source.samples);

  if (!spectrum) {
    dominantFrequenciesEl.textContent = "Not enough data for FFT.";
    fftInterpretationEl.textContent = "Select a larger waveform region.";
    return;
  }

  lastSpectrum = spectrum;
  lastSpectrumSourceName = source.name;

  drawSpectrumBackground(minFreq, maxFreq);

  const minDb = -110;
  const maxDb = 0;

  spectrumCtx.strokeStyle = "#b31b1b";
  spectrumCtx.lineWidth = 2.25;
  spectrumCtx.beginPath();

  let started = false;

  for (let i = 0; i < spectrum.magnitudes.length; i++) {
    const freq = spectrum.frequencies[i];

    if (freq < minFreq || freq > maxFreq) {
      continue;
    }

    const db = spectrum.magnitudes[i];

    const x = ((freq - minFreq) / (maxFreq - minFreq)) * spectrumCanvas.width;
    const y = spectrumCanvas.height - ((db - minDb) / (maxDb - minDb)) * spectrumCanvas.height;
    const yClamped = clamp(y, 0, spectrumCanvas.height);

    if (!started) {
      spectrumCtx.moveTo(x, yClamped);
      started = true;
    } else {
      spectrumCtx.lineTo(x, yClamped);
    }
  }

  spectrumCtx.stroke();

  const peaks = findDominantFrequencies(spectrum, minFreq, maxFreq);

  dominantFrequenciesEl.textContent =
    peaks.length === 0
      ? "No clear peaks in this selected region."
      : peaks
          .map(p => Math.round(p.freq) + " Hz (" + p.db.toFixed(1) + " dB)")
          .join(", ");

  fftInterpretationEl.textContent =
    interpretSpectrum(peaks) +
    " FFT averaged over " +
    spectrum.averagedFrames +
    " frame(s) from the selected waveform region.";

  spectrumCtx.fillStyle = "#1d1d1f";
  spectrumCtx.font = "12px -apple-system, BlinkMacSystemFont, Arial";

  for (const peak of peaks.slice(0, 6)) {
    const x = ((peak.freq - minFreq) / (maxFreq - minFreq)) * spectrumCanvas.width;
    const y = spectrumCanvas.height - ((peak.db - minDb) / (maxDb - minDb)) * spectrumCanvas.height;
    const yClamped = clamp(y, 14, spectrumCanvas.height - 22);

    spectrumCtx.beginPath();
    spectrumCtx.arc(x, yClamped, 4, 0, 2 * Math.PI);
    spectrumCtx.fill();

    spectrumCtx.fillText(
      Math.round(peak.freq) + " Hz",
      clamp(x + 7, 8, spectrumCanvas.width - 70),
      yClamped - 7
    );
  }

  downloadFftBtn.disabled = false;

  log(
    "FFT plotted from " +
      source.name +
      " using " +
      source.samples.length +
      " selected samples."
  );
}

function resetFftZoom() {
  fftMinFreqInput.value = 0;
  fftMaxFreqInput.value = SAMPLE_RATE / 2;
  plotNoiseSpectrum();
}

function downloadFftCsv() {
  if (!lastSpectrum) {
    return;
  }

  let csv = "frequency_hz,magnitude_db\n";

  for (let i = 0; i < lastSpectrum.frequencies.length; i++) {
    csv +=
      lastSpectrum.frequencies[i].toFixed(3) +
      "," +
      lastSpectrum.magnitudes[i].toFixed(6) +
      "\n";
  }

  const blob = new Blob([csv], {
    type: "text/csv"
  });

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  a.href = url;
  a.download = "fft_" + lastSpectrumSourceName + "_" + timestamp + ".csv";

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);

  log("FFT CSV downloaded.");
}