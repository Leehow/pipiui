"use strict";

(() => {
  const VERSION = 1;
  const LABEL = "pipiui.viability.echo.v1";
  const MAX_SDP_BYTES = 128 * 1024;
  const encoder = new TextEncoder();
  const config = window.__PIPI_REMOTE_PEER_CONFIG__;
  const state = document.getElementById("state");
  const echo = document.getElementById("echo");
  const start = document.getElementById("start");
  let peer = null;
  let channel = null;

  function setState(text, className = "") {
    state.textContent = text;
    state.className = className;
  }

  function closeCurrent() {
    if (channel) channel.close();
    if (peer) peer.close();
    channel = null;
    peer = null;
  }

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set(config.tokenHeader, config.token);
    if (options.body) headers.set("Content-Type", "application/json");
    return fetch(path, {...options, headers, cache: "no-store"});
  }

  function waitForICE(candidatePeer) {
    if (candidatePeer.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        candidatePeer.removeEventListener("icegatheringstatechange", changed);
        reject(new Error("Chrome ICE gathering timed out"));
      }, 5000);
      function changed() {
        if (candidatePeer.iceGatheringState !== "complete") return;
        window.clearTimeout(timeout);
        candidatePeer.removeEventListener("icegatheringstatechange", changed);
        resolve();
      }
      candidatePeer.addEventListener("icegatheringstatechange", changed);
    });
  }

  async function pollAnswer(session) {
    const deadline = session.expiresAtMilliseconds;
    const query = new URLSearchParams({
      sessionID: session.sessionID,
      generation: session.generation
    });
    while (Date.now() < deadline) {
      const response = await request(`/p2p-test/answer?${query}`);
      if (response.status === 200) return response.json();
      if (response.status !== 204) {
        throw new Error(`answer polling failed (${response.status})`);
      }
      await new Promise(resolve => window.setTimeout(resolve, 150));
    }
    throw new Error("answer polling expired");
  }

  async function run() {
    closeCurrent();
    start.disabled = true;
    echo.textContent = "尚未发送";
    echo.className = "";
    try {
      setState("读取 WKWebView host session…");
      const sessionResponse = await request("/p2p-test/config");
      if (!sessionResponse.ok) {
        throw new Error(`host unavailable (${sessionResponse.status})`);
      }
      const session = await sessionResponse.json();
      peer = new RTCPeerConnection({iceServers: []});
      channel = peer.createDataChannel(LABEL, {ordered: true});

      const echoCompleted = new Promise((resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error("DataChannel echo timed out")),
          8000
        );
        channel.onopen = () => {
          setState("ordered/reliable DataChannel 已打开，等待 echo…");
          const payload = `pipiui-wk-echo-${Date.now()}`;
          channel.send(JSON.stringify({
            v: VERSION,
            type: "echo",
            sessionID: session.sessionID,
            generation: session.generation,
            payload
          }));
          channel.onmessage = event => {
            let message;
            try {
              message = JSON.parse(event.data);
            } catch {
              reject(new Error("echo response is not JSON"));
              return;
            }
            if (message.v !== VERSION
                || message.type !== "echo"
                || message.sessionID !== session.sessionID
                || message.generation !== session.generation
                || message.payload !== payload) {
              reject(new Error("echo response contract mismatch"));
              return;
            }
            channel.send(JSON.stringify({
              v: VERSION,
              type: "echoAck",
              sessionID: session.sessionID,
              generation: session.generation,
              payload
            }));
            window.clearTimeout(timeout);
            setState("echo 往返已验证", "ok");
            echo.textContent = message.payload;
            echo.className = "ok";
            resolve();
          };
        };
        channel.onerror = () => reject(new Error("DataChannel error"));
      });

      setState("Chrome 正在生成完整 offer…");
      await peer.setLocalDescription(await peer.createOffer());
      await waitForICE(peer);
      const sdp = peer.localDescription && peer.localDescription.sdp;
      if (typeof sdp !== "string"
          || encoder.encode(sdp).byteLength > MAX_SDP_BYTES) {
        throw new Error("invalid Chrome offer");
      }
      const offerResponse = await request("/p2p-test/offer", {
        method: "POST",
        body: JSON.stringify({
          v: VERSION,
          sessionID: session.sessionID,
          generation: session.generation,
          expiresAtMilliseconds: session.expiresAtMilliseconds,
          sdp
        })
      });
      if (offerResponse.status !== 202) {
        throw new Error(`offer rejected (${offerResponse.status})`);
      }
      setState("等待 WKWebView answer…");
      const answer = await pollAnswer(session);
      await peer.setRemoteDescription({type: "answer", sdp: answer.sdp});
      await echoCompleted;
    } catch (error) {
      setState(String(error && error.message || error), "error");
      echo.className = "error";
      closeCurrent();
    } finally {
      start.disabled = false;
    }
  }

  start.addEventListener("click", run);
  void run();
})();
