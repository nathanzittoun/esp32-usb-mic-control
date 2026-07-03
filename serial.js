async function connectSerial() {
  if (inputSource === "computer") {
    await connectComputerMic();
    return;
  }

  try {
    if (!("serial" in navigator)) {
      alert("Web Serial is not supported. Use Chrome or Edge.");
      return;
    }

    port = await navigator.serial.requestPort();

    await port.open({
      baudRate: BAUD_RATE
    });

    reader = port.readable.getReader();
    writer = port.writable.getWriter();

    isConnected = true;
    memsConnectionType = "usb";

    connectBtn.disabled = true;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    calibrateNoiseBtn.disabled = false;
    plotSpectrumBtn.disabled = false;
    noiseAttenuatorBtn.disabled = false;

    setStatus("Connected", "connected");
    log("Connected to ESP32 over USB-C serial.");

    readLoop();

  } catch (error) {
    console.error(error);
    setStatus("Connection failed", "idle");
    log("Connection error: " + error.message);
  }
}

async function readLoop() {
  while (isConnected && reader) {
    try {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      if (value) {
        processIncomingBytes(value);
      }
    } catch (error) {
      console.error(error);
      log("Read error: " + error.message);
      break;
    }
  }
}

async function sendCommand(command) {
  if (!writer) {
    setStatus("Not connected", "idle");
    return;
  }

  const encoder = new TextEncoder();

  await writer.write(encoder.encode(command + "\n"));

  log("APP_SENT:" + command);
}

function processIncomingBytes(newBytes) {
  for (const b of newBytes) {
    byteBuffer.push(b);
  }

  while (byteBuffer.length >= 4) {
    if (byteBuffer[0] !== 0xAA || byteBuffer[1] !== 0x55) {
      byteBuffer.shift();
      continue;
    }

    const length = byteBuffer[2] | (byteBuffer[3] << 8);

    if (byteBuffer.length < 4 + length) {
      return;
    }

    const payload = byteBuffer.slice(4, 4 + length);
    byteBuffer = byteBuffer.slice(4 + length);

    addSamples(new Uint8Array(payload));
  }
}