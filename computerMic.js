async function connectComputerMic() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Computer microphone access is not supported in this browser.");
      return;
    }

    computerMediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    computerAudioContext = new AudioContext({
      sampleRate: SAMPLE_RATE
    });

    computerSourceNode = computerAudioContext.createMediaStreamSource(computerMediaStream);

    computerProcessorNode = computerAudioContext.createScriptProcessor(2048, 1, 1);

    computerProcessorNode.onaudioprocess = function(event) {
      if (!isRecording || inputSource !== "computer") {
        return;
      }

      const input = event.inputBuffer.getChannelData(0);
      const samples = new Int16Array(input.length);

      for (let i = 0; i < input.length; i++) {
        let s = input[i];

        if (s > 1) s = 1;
        if (s < -1) s = -1;

        samples[i] = Math.round(s * 32767);
      }

      addComputerMicSamples(samples);
    };

    computerSourceNode.connect(computerProcessorNode);
    computerProcessorNode.connect(computerAudioContext.destination);

    computerMicReady = true;
    isConnected = true;

    connectBtn.disabled = true;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    calibrateNoiseBtn.disabled = false;
    plotSpectrumBtn.disabled = false;
    noiseAttenuatorBtn.disabled = false;

    setStatus("Computer mic ready", "connected");
    log("Connected to computer microphone.");

  } catch (error) {
    console.error(error);
    setStatus("Computer mic failed", "idle");
    log("Computer mic error: " + error.message);
  }
}

function startComputerMicCapture() {
  if (computerAudioContext && computerAudioContext.state === "suspended") {
    computerAudioContext.resume();
  }

  log("Computer mic recording started.");
}

function stopComputerMicCapture() {
  log("Computer mic recording stopped.");
}

function addComputerMicSamples(samples) {
  if (!isRecording || inputSource !== "computer") {
    return;
  }

  samples = processNoiseAttenuator(samples, 1);

  currentChunks.push(samples);
  currentFrameCount += samples.length;
  currentValueCount += samples.length;

  for (let i = 0; i < samples.length; i++) {
    liveSamples.push(samples[i]);
  }

  if (liveSamples.length > MAX_LIVE_SAMPLES) {
    liveSamples = liveSamples.slice(liveSamples.length - MAX_LIVE_SAMPLES);
  }

  updateCurrentStats();
  drawLiveWaveform();
  updateNoiseIndicators(liveSamples);
}