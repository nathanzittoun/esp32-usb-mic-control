const SAMPLE_RATE = 16000;
const BAUD_RATE = 921600;
const MAX_LIVE_SAMPLES = 16000;
const FFT_SIZE = 4096;

let port;
let reader;
let writer;

let inputSource = "mems";
// options: "mems", "computer"
let noiseAttenuatorEnabled = false;

let memsConnectionType = "usb";
// options: "usb", "wifi"

let wifiSocket = null;
let wifiConnected = false;

let computerAudioContext = null;
let computerMediaStream = null;
let computerSourceNode = null;
let computerProcessorNode = null;
let computerMicReady = false;

let isConnected = false;
let isRecording = false;

let byteBuffer = [];

let currentChunks = [];
let currentFrameCount = 0;
let currentValueCount = 0;
let liveSamples = [];

let audioMode = "stereo";

let recordings = [];
let recordingIndex = 1;

let calibratedNoiseFloorDb = null;

let lastSpectrum = null;
let lastSpectrumSourceName = "none";
let analysisSelectionStart = 0;
let analysisSelectionEnd = 1;
let analysisDragMode = null;
// options: null, "left", "right", "middle"

const connectBtn = document.getElementById("connectBtn");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const calibrateNoiseBtn = document.getElementById("calibrateNoiseBtn");
const plotSpectrumBtn = document.getElementById("plotSpectrumBtn");
const resetZoomBtn = document.getElementById("resetZoomBtn");
const downloadFftBtn = document.getElementById("downloadFftBtn");
const modeSelector = document.getElementById("modeSelector");
const analysisWaveformCanvas = document.getElementById("analysisWaveformCanvas");
const analysisWaveformCtx = analysisWaveformCanvas.getContext("2d");
const selectedRangeLabel = document.getElementById("selectedRangeLabel");
const connectWifiBtn = document.getElementById("connectWifiBtn");

const statusDiv = document.getElementById("status");
const statusDot = document.getElementById("statusDot");

const durationBox = document.getElementById("durationBox");
const sampleBox = document.getElementById("sampleBox");
const recordingStateBox = document.getElementById("recordingStateBox");

const rmsDbEl = document.getElementById("rmsDb");
const peakDbEl = document.getElementById("peakDb");
const clipPercentEl = document.getElementById("clipPercent");
const hum60El = document.getElementById("hum60");
const hum120El = document.getElementById("hum120");
const rumbleLevelEl = document.getElementById("rumbleLevel");
const noiseFloorEl = document.getElementById("noiseFloor");
const noiseCommentEl = document.getElementById("noiseComment");
const noiseAttenuatorBtn = document.getElementById("noiseAttenuatorBtn");

const rmsBar = document.getElementById("rmsBar");
const peakBar = document.getElementById("peakBar");
const clipBar = document.getElementById("clipBar");
const hum60Bar = document.getElementById("hum60Bar");
const hum120Bar = document.getElementById("hum120Bar");
const rumbleBar = document.getElementById("rumbleBar");

const spectrumCanvas = document.getElementById("spectrumCanvas");
const spectrumCtx = spectrumCanvas.getContext("2d");
const dominantFrequenciesEl = document.getElementById("dominantFrequencies");
const fftInterpretationEl = document.getElementById("fftInterpretation");
const fftRangeLabel = document.getElementById("fftRangeLabel");
const fftMinFreqInput = document.getElementById("fftMinFreqInput");
const fftMaxFreqInput = document.getElementById("fftMaxFreqInput");
const analysisSourceSelect = document.getElementById("analysisSourceSelect");

const recordingList = document.getElementById("recordingList");
const recordingCount = document.getElementById("recordingCount");
const logDiv = document.getElementById("log");

const canvas = document.getElementById("waveform");
const ctx = canvas.getContext("2d");

function log(message) {
  const line = document.createElement("div");
  const time = new Date().toLocaleTimeString();
  line.textContent = "[" + time + "] " + message;
  logDiv.appendChild(line);
  logDiv.scrollTop = logDiv.scrollHeight;
}

function setStatus(message, state = "idle") {
  statusDiv.textContent = message;
  statusDot.className = "statusDot";

  if (state === "connected") {
    statusDot.classList.add("connected");
  }

  if (state === "recording") {
    statusDot.classList.add("recording");
  }
}

function updateCurrentStats() {
  const duration = currentFrameCount / SAMPLE_RATE;
  const channelText = audioMode === "stereo" ? "2 channels" : "1 channel";

  durationBox.textContent = "Duration: " + duration.toFixed(2) + " s";
  sampleBox.textContent = "Frames: " + currentFrameCount + " · " + channelText;
  recordingStateBox.textContent = isRecording ? "Recording" : "Idle";
}

async function sendMemsCommand(command) {
  if (memsConnectionType === "wifi") {
    sendWifiCommand(command);
    return;
  }

  await sendCommand(command);
}

function clearCanvas() {
  ctx.fillStyle = "#f0f0f2";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#d8d8dc";
  ctx.lineWidth = 1;

  for (let i = 0; i <= 4; i++) {
    const y = (canvas.height / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "#b8b8bd";
  ctx.beginPath();
  ctx.moveTo(0, canvas.height / 2);
  ctx.lineTo(canvas.width, canvas.height / 2);
  ctx.stroke();
}

function drawLiveWaveform() {
  clearCanvas();

  if (liveSamples.length < 2) {
    return;
  }

  ctx.strokeStyle = "#b31b1b";
  ctx.lineWidth = 2;
  ctx.beginPath();

  const step = Math.max(1, Math.floor(liveSamples.length / canvas.width));
  let x = 0;

  for (let i = 0; i < liveSamples.length; i += step) {
    const sample = liveSamples[i] / 32768;
    const y = canvas.height / 2 - sample * canvas.height * 0.42;

    if (x === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }

    x++;

    if (x >= canvas.width) {
      break;
    }
  }

  ctx.stroke();
}

async function startRecording() {
  if (!isConnected) {
    return;
  }

  resetNoiseAttenuator();

  currentChunks = [];
  currentFrameCount = 0;
  currentValueCount = 0;
  liveSamples = [];
  byteBuffer = [];

  isRecording = true;

  startBtn.disabled = true;
  stopBtn.disabled = false;

  setStatus("Recording", "recording");
  updateCurrentStats();
  clearCanvas();

  if (inputSource === "mems") {
    await sendMemsCommand("START");
  } else if (inputSource === "computer") {
    startComputerMicCapture();
  }
}

async function stopRecording() {
  if (!isConnected || !isRecording) {
    return;
  }

  isRecording = false;

  if (inputSource === "mems") {
    await sendMemsCommand("STOP");
  } else if (inputSource === "computer") {
    stopComputerMicCapture();
  }

  startBtn.disabled = false;
  stopBtn.disabled = true;

  if (currentFrameCount > 0) {
    saveCurrentRecording();
    setStatus("Recording saved", "connected");
    startBtn.textContent = "New recording";
  } else {
    setStatus("Stopped", "connected");
  }

  updateCurrentStats();
}

async function setInputSource(source) {
  if (isRecording) {
    log("Cannot change input source while recording.");
    return;
  }

  if (inputSource === source) {
    return;
  }

  await disconnectCurrentSource();

  inputSource = source;

  document.querySelectorAll(".sourceBtn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.source === source);
  });

  isConnected = false;

  connectBtn.disabled = false;
  startBtn.disabled = true;
  stopBtn.disabled = true;
  calibrateNoiseBtn.disabled = true;
  plotSpectrumBtn.disabled = true;
  noiseAttenuatorBtn.disabled = true;
  connectWifiBtn.disabled = source !== "mems";

  if (source === "mems") {
    connectBtn.textContent = "Connect MEMS device";
    modeSelector.style.display = "grid";
    setAudioMode("stereo");
    setStatus("MEMS selected", "idle");
  }

  if (source === "computer") {
    connectBtn.textContent = "Connect computer mic";
    modeSelector.style.display = "none";
    audioMode = "computer";
    updateCurrentStats();
    setStatus("Computer mic selected", "idle");
  }

  log("Input source selected: " + source + ".");
}

async function disconnectCurrentSource() {
  try {
    if (reader) {
      await reader.cancel();
      reader.releaseLock();
      reader = null;
    }
  } catch (error) {
    console.warn("Reader disconnect issue:", error);
  }

  try {
    if (writer) {
      writer.releaseLock();
      writer = null;
    }
  } catch (error) {
    console.warn("Writer disconnect issue:", error);
  }

  try {
    if (port) {
      await port.close();
      port = null;
    }
  } catch (error) {
    console.warn("Serial port close issue:", error);
  }

  try {
    if (computerProcessorNode) {
      computerProcessorNode.disconnect();
      computerProcessorNode = null;
    }

    if (computerSourceNode) {
      computerSourceNode.disconnect();
      computerSourceNode = null;
    }

    if (computerMediaStream) {
      computerMediaStream.getTracks().forEach(track => track.stop());
      computerMediaStream = null;
    }

    if (computerAudioContext) {
      await computerAudioContext.close();
      computerAudioContext = null;
    }

    computerMicReady = false;
  } catch (error) {
    console.warn("Computer mic disconnect issue:", error);
  }

  try {
    if (wifiSocket) {
      wifiSocket.close();
      wifiSocket = null;
    }

    wifiConnected = false;
  } catch (error) {
    console.warn("Wi-Fi disconnect issue:", error);
  }

  isConnected = false;
  wifiConnected = false;
  noiseAttenuatorBtn.disabled = true;
}