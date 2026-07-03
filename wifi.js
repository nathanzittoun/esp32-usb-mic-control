async function connectWifiMems() {
  if (inputSource !== "mems") {
    log("Wi-Fi MEMS can only be used when MEMS mics are selected.");
    return;
  }

  try {
    setStatus("Connecting to MEMS Wi-Fi...", "idle");
    log("Connecting to ESP32 WebSocket...");

    memsConnectionType = "wifi";

    wifiSocket = new WebSocket("ws://192.168.4.1:81");

    wifiSocket.binaryType = "arraybuffer";

    wifiSocket.onopen = function() {
      wifiConnected = true;
      isConnected = true;

      connectBtn.disabled = true;
      connectWifiBtn.disabled = true;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      calibrateNoiseBtn.disabled = false;
      plotSpectrumBtn.disabled = false;
      noiseAttenuatorBtn.disabled = false;

      setStatus("Connected by Wi-Fi", "connected");
      log("Connected to MEMS over Wi-Fi WebSocket.");
    };

    wifiSocket.onmessage = function(event) {
      if (typeof event.data === "string") {
        log("ESP32_WIFI:" + event.data);
        return;
      }

      const payload = new Uint8Array(event.data);

      // Payload is already:
      // right,left,right,left...
      // int16 little-endian
      addSamples(payload);
    };

    wifiSocket.onerror = function(error) {
      console.error(error);
      setStatus("Wi-Fi connection error", "idle");
      log("Wi-Fi WebSocket error.");
    };

    wifiSocket.onclose = function() {
      wifiConnected = false;

      if (memsConnectionType === "wifi") {
        isConnected = false;
        startBtn.disabled = true;
        stopBtn.disabled = true;
        connectWifiBtn.disabled = false;
        connectBtn.disabled = false;
        setStatus("Wi-Fi disconnected", "idle");
        log("Wi-Fi WebSocket disconnected.");
      }
    };

  } catch (error) {
    console.error(error);
    setStatus("Wi-Fi connection failed", "idle");
    log("Wi-Fi connection failed: " + error.message);
  }
}

function sendWifiCommand(command) {
  if (!wifiSocket || wifiSocket.readyState !== WebSocket.OPEN) {
    log("Wi-Fi socket is not connected.");
    setStatus("Wi-Fi not connected", "idle");
    return;
  }

  wifiSocket.send(command);
  log("APP_WIFI_SENT:" + command);
}