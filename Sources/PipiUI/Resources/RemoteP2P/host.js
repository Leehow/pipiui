"use strict";

(() => {
  const VERSION = 1;
  const LABEL = "pipiui.viability.echo.v1";
  const REMOTE_LABEL = "pipiui.remote.v1";
  const MAX_SDP_BYTES = 128 * 1024;
  const MAX_ECHO_BYTES = 64 * 1024;
  const MAX_CHUNK_BYTES = 64 * 1024;
  const MAX_REQUEST_BYTES = 256 * 1024;
  const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
  const MAX_CANDIDATES = 64;
  const MAX_CONNECTION_LEASE_MS = 24 * 60 * 60 * 1000;
  const BUFFER_LOW_WATER = 256 * 1024;
  const BUFFER_HIGH_WATER = 1024 * 1024;
  const MAX_QUEUED_BYTES = 12 * 1024 * 1024;
  const encoder = new TextEncoder();
  let generation = "";
  let currentAttemptToken = null;
  let currentAttempt = null;
  let productionAttempt = null;

  function post(value) {
    window.webkit.messageHandlers.pipiRemotePeer.postMessage(value);
  }

  function exactKeys(value, expected) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    return actual.length === wanted.length
      && actual.every((key, index) => key === wanted[index]);
  }

  function opaque(value) {
    return typeof value === "string"
      && value.length >= 16
      && value.length <= 128
      && /^[A-Za-z0-9_-]+$/.test(value);
  }

  function owns(attempt) {
    return currentAttempt === attempt
      && currentAttemptToken === attempt.token
      && generation === attempt.generation;
  }

  function closeAttempt(attempt) {
    if (!attempt) return;
    if (attempt.runtime.channel) {
      attempt.runtime.channel.onopen = null;
      attempt.runtime.channel.onclose = null;
      attempt.runtime.channel.onmessage = null;
      attempt.runtime.channel.close();
    }
    attempt.runtime.channel = null;
    attempt.runtime.pendingEchoPayload = null;
    attempt.peer.ondatachannel = null;
    attempt.peer.onconnectionstatechange = null;
    attempt.peer.close();
  }

  function invalidateAttempt(attempt) {
    if (owns(attempt)) {
      currentAttempt = null;
      currentAttemptToken = null;
    }
    closeAttempt(attempt);
  }

  function invalidateCurrentAttempt() {
    const attempt = currentAttempt;
    currentAttempt = null;
    currentAttemptToken = null;
    closeAttempt(attempt);
  }

  function reportError(attempt, message) {
    if (!owns(attempt)) return;
    const safe = String(message || "unknown peer error").slice(0, 512);
    currentAttempt = null;
    currentAttemptToken = null;
    closeAttempt(attempt);
    post({
      v: VERSION,
      type: "error",
      generation: attempt.generation,
      sessionID: attempt.sessionID,
      message: safe
    });
  }

  function waitForICE(candidatePeer) {
    if (candidatePeer.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        candidatePeer.removeEventListener("icegatheringstatechange", changed);
        reject(new Error("WKWebView ICE gathering timed out"));
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

  function attachChannel(attempt, candidate) {
    if (!owns(attempt)) {
      candidate.close();
      return;
    }
    if (candidate.label !== LABEL || candidate.ordered !== true) {
      candidate.close();
      throw new Error("unexpected DataChannel contract");
    }
    attempt.runtime.channel = candidate;
    candidate.onopen = () => {
      if (!owns(attempt) || attempt.runtime.channel !== candidate) return;
      post({
        v: VERSION,
        type: "channel",
        generation: attempt.generation,
        sessionID: attempt.sessionID,
        state: "open"
      });
    };
    candidate.onclose = () => {
      if (!owns(attempt) || attempt.runtime.channel !== candidate) return;
      post({
        v: VERSION,
        type: "channel",
        generation: attempt.generation,
        sessionID: attempt.sessionID,
        state: "closed"
      });
    };
    candidate.onmessage = event => {
      if (!owns(attempt) || attempt.runtime.channel !== candidate) return;
      if (typeof event.data !== "string"
          || encoder.encode(event.data).byteLength > MAX_ECHO_BYTES) {
        candidate.close();
        return;
      }
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        candidate.close();
        return;
      }
      if (!exactKeys(message, ["v", "type", "sessionID", "generation", "payload"])
          || message.v !== VERSION
          || (message.type !== "echo" && message.type !== "echoAck")
          || message.sessionID !== attempt.sessionID
          || message.generation !== attempt.generation
          || typeof message.payload !== "string"
          || encoder.encode(message.payload).byteLength > MAX_ECHO_BYTES) {
        candidate.close();
        return;
      }
      if (message.type === "echo") {
        attempt.runtime.pendingEchoPayload = message.payload;
        candidate.send(JSON.stringify(message));
        return;
      }
      if (attempt.runtime.pendingEchoPayload === null
          || message.payload !== attempt.runtime.pendingEchoPayload) {
        candidate.close();
        return;
      }
      post({
        v: VERSION,
        type: "echoVerified",
        generation: attempt.generation,
        sessionID: attempt.sessionID,
        payload: message.payload
      });
      attempt.runtime.pendingEchoPayload = null;
    };
  }

  function validateOffer(message, candidateGeneration) {
    if (!exactKeys(
      message,
      ["v", "sessionID", "generation", "expiresAtMilliseconds", "sdp"]
    )
        || message.v !== VERSION
        || !opaque(message.sessionID)
        || message.generation !== candidateGeneration
        || !Number.isSafeInteger(message.expiresAtMilliseconds)
        || message.expiresAtMilliseconds <= Date.now()
        || typeof message.sdp !== "string"
        || encoder.encode(message.sdp).byteLength > MAX_SDP_BYTES
        || !message.sdp.startsWith("v=0")) {
      throw new Error("invalid offer contract");
    }
  }

  async function negotiateOffer(attempt, sdp) {
    const candidatePeer = attempt.peer;
    await candidatePeer.setRemoteDescription({type: "offer", sdp});
    if (!owns(attempt)) {
      closeAttempt(attempt);
      return;
    }
    const answer = await candidatePeer.createAnswer();
    if (!owns(attempt)) {
      closeAttempt(attempt);
      return;
    }
    await candidatePeer.setLocalDescription(answer);
    if (!owns(attempt)) {
      closeAttempt(attempt);
      return;
    }
    await waitForICE(candidatePeer);
    if (!owns(attempt)) {
      closeAttempt(attempt);
      return;
    }
    const answerSDP = candidatePeer.localDescription
      && candidatePeer.localDescription.sdp;
    if (typeof answerSDP !== "string"
        || encoder.encode(answerSDP).byteLength > MAX_SDP_BYTES) {
      throw new Error("invalid WKWebView answer");
    }
    if (!owns(attempt)) {
      closeAttempt(attempt);
      return;
    }
    post({
      v: VERSION,
      type: "answer",
      generation: attempt.generation,
      sessionID: attempt.sessionID,
      sdp: answerSDP
    });
  }

  function acceptOffer(message) {
    const candidateGeneration = generation;
    validateOffer(message, candidateGeneration);
    invalidateCurrentAttempt();

    const candidateSessionID = message.sessionID;
    const candidatePeer = new RTCPeerConnection({iceServers: []});
    const attempt = Object.freeze({
      token: Symbol("pipiRemotePeerAttempt"),
      generation: candidateGeneration,
      sessionID: candidateSessionID,
      peer: candidatePeer,
      runtime: {
        channel: null,
        pendingEchoPayload: null
      }
    });
    currentAttempt = attempt;
    currentAttemptToken = attempt.token;

    candidatePeer.onconnectionstatechange = () => {
      if (!owns(attempt)) return;
      const state = candidatePeer.connectionState;
      if (state === "failed" || state === "disconnected" || state === "closed") {
        post({
          v: VERSION,
          type: "peer",
          generation: attempt.generation,
          sessionID: attempt.sessionID,
          state
        });
      }
    };
    candidatePeer.ondatachannel = event => {
      if (!owns(attempt)) {
        event.channel.close();
        return;
      }
      try {
        attachChannel(attempt, event.channel);
      } catch (error) {
        reportError(attempt, error);
      }
    };
    void negotiateOffer(attempt, message.sdp).catch(error => {
      if (!owns(attempt)) {
        closeAttempt(attempt);
        return;
      }
      reportError(attempt, error);
    });
    return true;
  }

  function resetSession(message) {
    if (!exactKeys(message, ["generation", "sessionID"])
        || !currentAttempt
        || message.generation !== currentAttempt.generation
        || message.sessionID !== currentAttempt.sessionID
        || !owns(currentAttempt)) {
      return false;
    }
    invalidateAttempt(currentAttempt);
    return true;
  }

  function uuid(value) {
    return typeof value === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
  }

  function base64URLBytes(value, expectedLength) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
    try {
      const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
      const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
      if (expectedLength !== undefined && binary.length !== expectedLength) return null;
      return binary.length;
    } catch {
      return null;
    }
  }

  function randomNonce() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function canonicalFingerprint(value) {
    if (typeof value !== "string") return null;
    const candidate = value.replace(/^[ \t]+|[ \t]+$/g, "");
    const match = /^([A-Za-z0-9-]+) +([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){31})$/
      .exec(candidate);
    return match && match[1].toLowerCase() === "sha-256"
      ? `sha-256 ${match[2].toUpperCase()}`
      : null;
  }

  function sdpFingerprint(sdp) {
    if (typeof sdp !== "string") return null;
    const values = [];
    for (const rawLine of sdp.split(/\r\n|\n|\r/)) {
      const line = rawLine.replace(/^[ \t]+|[ \t]+$/g, "");
      if (!line.toLowerCase().startsWith("a=fingerprint:")) continue;
      const canonical = canonicalFingerprint(
        line.slice("a=fingerprint:".length)
      );
      if (!canonical) return null;
      values.push(canonical);
    }
    return values.length > 0
      && values.every(value => value === values[0]) ? values[0] : null;
  }

  function productionOwns(attempt) {
    return productionAttempt === attempt
      && attempt.generation === generation
      && (attempt.runtime.established || attempt.expiresAt > Date.now());
  }

  function closeProduction(attempt, reason, notify = true) {
    if (!attempt) return;
    if (productionAttempt === attempt) productionAttempt = null;
    const channel = attempt.runtime.channel;
    if (channel) {
      channel.onopen = null;
      channel.onclose = null;
      channel.onmessage = null;
      channel.onbufferedamountlow = null;
      channel.close();
    }
    attempt.peer.ondatachannel = null;
    attempt.peer.onicecandidate = null;
    attempt.peer.onconnectionstatechange = null;
    attempt.peer.close();
    if (attempt.runtime.expiryTimer !== null) {
      window.clearTimeout(attempt.runtime.expiryTimer);
      attempt.runtime.expiryTimer = null;
    }
    attempt.runtime.queue.length = 0;
    attempt.runtime.queuedBytes = 0;
    if (notify) {
      post({
        v: VERSION,
        type: "connectionClosed",
        generation: attempt.generation,
        connectionID: attempt.connectionID,
        reason: String(reason || "closed").slice(0, 256)
      });
    }
  }

  function failProduction(attempt, reason) {
    if (!productionOwns(attempt)) return;
    closeProduction(attempt, reason, true);
  }

  function validChunk(value, kind) {
    if (!exactKeys(value, [
      "v", "type", "messageID", "kind", "chunkIndex", "chunkCount",
      "totalBytes", "expiresAt", "payload"
    ])
        || value.v !== VERSION
        || value.type !== "chunk"
        || !uuid(value.messageID)
        || value.kind !== kind
        || !Number.isSafeInteger(value.chunkIndex)
        || !Number.isSafeInteger(value.chunkCount)
        || !Number.isSafeInteger(value.totalBytes)
        || !Number.isSafeInteger(value.expiresAt)
        || value.chunkCount < 1
        || value.chunkIndex < 0
        || value.chunkIndex >= value.chunkCount
        || value.totalBytes < 0
        || value.expiresAt <= Date.now()
        || value.expiresAt > Date.now() + 15000
        || value.totalBytes > (kind === "request" ? MAX_REQUEST_BYTES : MAX_RESPONSE_BYTES)
        || value.chunkCount > Math.max(1, Math.ceil(
          (kind === "request" ? MAX_REQUEST_BYTES : MAX_RESPONSE_BYTES)
            / MAX_CHUNK_BYTES
        ))) return false;
    const decoded = base64URLBytes(value.payload);
    return decoded !== null && decoded <= MAX_CHUNK_BYTES;
  }

  function flushProduction(attempt) {
    if (attempt.runtime.binding
        && Date.now() >= attempt.runtime.binding.activeLeaseExpiresAt) {
      closeProduction(attempt, "maximum connection lease expired", true);
      return;
    }
    const channel = attempt.runtime.channel;
    if (!productionOwns(attempt) || !channel || channel.readyState !== "open") return;
    if (!attempt.runtime.bindSent) {
      if (!attempt.runtime.binding) return;
      const bindText = JSON.stringify(attempt.runtime.binding);
      channel.send(bindText);
      attempt.runtime.bindSent = true;
      attempt.runtime.established = true;
      post({
        v: VERSION,
        type: "connectionOpen",
        generation: attempt.generation,
        connectionID: attempt.connectionID
      });
      if (attempt.runtime.expiryTimer !== null) {
        window.clearTimeout(attempt.runtime.expiryTimer);
      }
      attempt.runtime.expiryTimer = window.setTimeout(() => {
        if (productionAttempt === attempt) {
          closeProduction(attempt, "maximum connection lease expired", true);
        }
      }, Math.max(0, attempt.runtime.binding.activeLeaseExpiresAt - Date.now()));
    }
    while (attempt.runtime.queue.length > 0
        && channel.bufferedAmount < BUFFER_HIGH_WATER) {
      const next = attempt.runtime.queue.shift();
      attempt.runtime.queuedBytes -= encoder.encode(next).byteLength;
      channel.send(next);
    }
  }

  function attachProductionChannel(attempt, channel) {
    if (!productionOwns(attempt)) {
      channel.close();
      return;
    }
    if (channel.label !== REMOTE_LABEL
        || channel.ordered !== true
        || channel.maxRetransmits != null
        || channel.maxPacketLifeTime != null) {
      channel.close();
      throw new Error("unexpected production DataChannel contract");
    }
    attempt.runtime.channel = channel;
    channel.bufferedAmountLowThreshold = BUFFER_LOW_WATER;
    channel.onbufferedamountlow = () => flushProduction(attempt);
    channel.onopen = () => flushProduction(attempt);
    channel.onclose = () => {
      if (productionAttempt === attempt) closeProduction(attempt, "DataChannel closed", true);
    };
    channel.onmessage = event => {
      if (!productionOwns(attempt) || attempt.runtime.channel !== channel) return;
      if (attempt.runtime.binding
          && Date.now() >= attempt.runtime.binding.activeLeaseExpiresAt) {
        closeProduction(attempt, "maximum connection lease expired", true);
        return;
      }
      if (!attempt.runtime.bindSent || typeof event.data !== "string"
          || encoder.encode(event.data).byteLength > MAX_CHUNK_BYTES * 2) {
        failProduction(attempt, "invalid DataChannel ordering");
        return;
      }
      let envelope;
      try {
        envelope = JSON.parse(event.data);
      } catch {
        failProduction(attempt, "invalid chunk JSON");
        return;
      }
      if (!validChunk(envelope, "request")) {
        failProduction(attempt, "invalid request chunk");
        return;
      }
      post({
        v: VERSION,
        type: "connectionData",
        generation: attempt.generation,
        connectionID: attempt.connectionID,
        envelope
      });
    };
  }

  function validateConnectionOffer(message) {
    if (!exactKeys(message, [
      "v", "generation", "connectionID", "deviceID", "expiresAt",
      "browserNonce", "offerFingerprint", "offerSDP"
    ])
        || message.v !== VERSION
        || message.generation !== generation
        || !uuid(message.connectionID)
        || !uuid(message.deviceID)
        || !Number.isSafeInteger(message.expiresAt)
        || message.expiresAt <= Date.now()
        || message.expiresAt > Date.now() + 32000
        || base64URLBytes(message.browserNonce, 32) === null
        || canonicalFingerprint(message.offerFingerprint) !== message.offerFingerprint
        || typeof message.offerSDP !== "string"
        || !message.offerSDP.startsWith("v=0")
        || encoder.encode(message.offerSDP).byteLength > MAX_SDP_BYTES
        || sdpFingerprint(message.offerSDP) !== message.offerFingerprint) {
      throw new Error("invalid production offer contract");
    }
  }

  async function negotiateConnection(attempt, offerSDP) {
    await attempt.peer.setRemoteDescription({type: "offer", sdp: offerSDP});
    if (!productionOwns(attempt)) return;
    const answer = await attempt.peer.createAnswer();
    if (!productionOwns(attempt)) return;
    await attempt.peer.setLocalDescription(answer);
    if (!productionOwns(attempt)) return;
    const answerSDP = attempt.peer.localDescription && attempt.peer.localDescription.sdp;
    const answerFingerprint = sdpFingerprint(answerSDP);
    if (typeof answerSDP !== "string"
        || encoder.encode(answerSDP).byteLength > MAX_SDP_BYTES
        || !answerFingerprint) {
      throw new Error("invalid production answer");
    }
    attempt.answerFingerprint = answerFingerprint;
    post({
      v: VERSION,
      type: "connectionAnswer",
      generation: attempt.generation,
      connectionID: attempt.connectionID,
      hostNonce: attempt.hostNonce,
      answerFingerprint,
      answerSDP
    });
  }

  function acceptConnection(message) {
    validateConnectionOffer(message);
    if (productionAttempt) closeProduction(productionAttempt, "replaced", true);
    const peer = new RTCPeerConnection({iceServers: []});
    const attempt = {
      generation,
      connectionID: message.connectionID,
      deviceID: message.deviceID,
      expiresAt: message.expiresAt,
      browserNonce: message.browserNonce,
      offerFingerprint: message.offerFingerprint,
      answerFingerprint: null,
      hostNonce: randomNonce(),
      peer,
      remoteCandidateCount: 0,
      runtime: {
        channel: null,
        binding: null,
        bindSent: false,
        established: false,
        queue: [],
        queuedBytes: 0,
        expiryTimer: null
      }
    };
    productionAttempt = attempt;
    attempt.runtime.expiryTimer = window.setTimeout(() => {
      if (productionAttempt === attempt) {
        closeProduction(attempt, "signaling session expired", true);
      }
    }, Math.max(1, attempt.expiresAt - Date.now()));
    peer.onicecandidate = event => {
      if (!productionOwns(attempt) || !event.candidate) return;
      const candidate = event.candidate;
      post({
        v: VERSION,
        type: "connectionCandidate",
        generation: attempt.generation,
        connectionID: attempt.connectionID,
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid || "",
        sdpMLineIndex: candidate.sdpMLineIndex || 0
      });
    };
    peer.onconnectionstatechange = () => {
      if (!productionOwns(attempt)) return;
      if (["failed", "disconnected", "closed"].includes(peer.connectionState)) {
        closeProduction(attempt, `peer ${peer.connectionState}`, true);
      }
    };
    peer.ondatachannel = event => {
      try {
        attachProductionChannel(attempt, event.channel);
      } catch (error) {
        failProduction(attempt, error);
      }
    };
    void negotiateConnection(attempt, message.offerSDP).catch(error => {
      failProduction(attempt, error);
    });
    return true;
  }

  function addCandidate(message) {
    if (!exactKeys(message, [
      "v", "generation", "connectionID", "candidate", "sdpMid", "sdpMLineIndex"
    ])
        || message.v !== VERSION
        || !productionAttempt
        || message.generation !== generation
        || message.connectionID !== productionAttempt.connectionID
        || typeof message.candidate !== "string"
        || encoder.encode(message.candidate).byteLength > 4096
        || typeof message.sdpMid !== "string"
        || encoder.encode(message.sdpMid).byteLength > 256
        || !Number.isSafeInteger(message.sdpMLineIndex)
        || message.sdpMLineIndex < 0
        || message.sdpMLineIndex > 65535
        || productionAttempt.remoteCandidateCount >= MAX_CANDIDATES) {
      throw new Error("invalid remote candidate");
    }
    const attempt = productionAttempt;
    attempt.remoteCandidateCount += 1;
    void attempt.peer.addIceCandidate({
      candidate: message.candidate,
      sdpMid: message.sdpMid,
      sdpMLineIndex: message.sdpMLineIndex
    }).catch(error => failProduction(attempt, error));
    return true;
  }

  function installBinding(message) {
    if (!exactKeys(message, [
      "v", "type", "generation", "connectionID", "deviceID",
      "publicKeyX963", "deviceFingerprint", "hostEpoch", "browserNonce",
      "hostNonce", "expiresAt", "offerFingerprint", "answerFingerprint",
      "activeLeaseExpiresAt",
      "signatureDER"
    ])
        || message.v !== VERSION
        || message.type !== "bind"
        || !productionAttempt
        || !productionOwns(productionAttempt)
        || message.generation !== generation
        || message.connectionID !== productionAttempt.connectionID
        || message.deviceID !== productionAttempt.deviceID
        || !uuid(message.hostEpoch)
        || message.browserNonce !== productionAttempt.browserNonce
        || message.hostNonce !== productionAttempt.hostNonce
        || message.expiresAt !== productionAttempt.expiresAt
        || !Number.isSafeInteger(message.activeLeaseExpiresAt)
        || message.activeLeaseExpiresAt
          !== message.expiresAt + MAX_CONNECTION_LEASE_MS
        || message.activeLeaseExpiresAt <= Date.now()
        || message.offerFingerprint !== productionAttempt.offerFingerprint
        || message.answerFingerprint !== productionAttempt.answerFingerprint
        || canonicalFingerprint(message.offerFingerprint) !== message.offerFingerprint
        || canonicalFingerprint(message.answerFingerprint) !== message.answerFingerprint
        || base64URLBytes(message.publicKeyX963, 65) === null
        || typeof message.deviceFingerprint !== "string"
        || !/^[0-9a-f]{64}$/.test(message.deviceFingerprint)
        || (base64URLBytes(message.signatureDER) ?? 0) < 64
        || (base64URLBytes(message.signatureDER) ?? 81) > 80) {
      throw new Error("invalid binding");
    }
    productionAttempt.runtime.binding = {
      v: VERSION,
      type: "bind",
      connectionID: message.connectionID,
      deviceID: message.deviceID,
      publicKeyX963: message.publicKeyX963,
      deviceFingerprint: message.deviceFingerprint,
      hostEpoch: message.hostEpoch,
      browserNonce: message.browserNonce,
      hostNonce: message.hostNonce,
      expiresAt: message.expiresAt,
      activeLeaseExpiresAt: message.activeLeaseExpiresAt,
      offerFingerprint: message.offerFingerprint,
      answerFingerprint: message.answerFingerprint,
      signatureDER: message.signatureDER
    };
    flushProduction(productionAttempt);
    return true;
  }

  function sendChunks(message) {
    if (!exactKeys(message, [
      "v", "generation", "connectionID", "chunks"
    ])
        || message.v !== VERSION
        || !productionAttempt
        || message.generation !== generation
        || message.connectionID !== productionAttempt.connectionID
        || !Array.isArray(message.chunks)
        || message.chunks.length < 1
        || message.chunks.length > 128) {
      throw new Error("invalid response chunks");
    }
    if (productionAttempt.runtime.binding
        && Date.now() >= productionAttempt.runtime.binding.activeLeaseExpiresAt) {
      closeProduction(
        productionAttempt,
        "maximum connection lease expired",
        true
      );
      throw new Error("connection lease expired");
    }
    const serialized = [];
    let addedBytes = 0;
    for (const chunk of message.chunks) {
      if (!validChunk(chunk, "response")) throw new Error("invalid response chunk");
      const text = JSON.stringify(chunk);
      addedBytes += encoder.encode(text).byteLength;
      serialized.push(text);
    }
    if (productionAttempt.runtime.queuedBytes + addedBytes > MAX_QUEUED_BYTES) {
      failProduction(productionAttempt, "DataChannel backpressure limit");
      return false;
    }
    productionAttempt.runtime.queue.push(...serialized);
    productionAttempt.runtime.queuedBytes += addedBytes;
    flushProduction(productionAttempt);
    return true;
  }

  function closeConnection(message) {
    if (!exactKeys(message, ["v", "generation", "connectionID"])
        || message.v !== VERSION
        || !productionAttempt
        || message.generation !== generation
        || message.connectionID !== productionAttempt.connectionID) return false;
    closeProduction(productionAttempt, "closed by host", false);
    return true;
  }

  window.pipiRemotePeer = Object.freeze({
    start(configuration) {
      if (!exactKeys(configuration, ["generation"])
          || !opaque(configuration.generation)) {
        throw new Error("invalid host generation");
      }
      invalidateCurrentAttempt();
      if (productionAttempt) {
        closeProduction(productionAttempt, "host generation replaced", false);
      }
      generation = configuration.generation;
      post({v: VERSION, type: "ready", generation});
      return true;
    },
    acceptOffer,
    resetSession,
    acceptConnection,
    addCandidate,
    installBinding,
    sendChunks,
    closeConnection
  });
})();
