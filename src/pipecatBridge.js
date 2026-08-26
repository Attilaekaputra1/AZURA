const WebSocket = require('ws');
const { globalVoiceTelemetry } = require('./voiceTelemetry');

class PipecatBridgeClient {
  constructor(wsUrl = 'ws://127.0.0.1:8765') {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.connected = false;
    this.reconnectTimer = null;
    this.activeSessions = new Map(); // sessionId -> sessionData
    this.eventListeners = new Map();
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        this.connected = true;
        console.log(`[Pipecat Bridge]: 🔗 Connected to Pipecat Realtime Layer at ${this.wsUrl}`);
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      });

      this.ws.on('message', (data, isBinary) => {
        if (isBinary) {
          this.emit('audio_frame', data);
        } else {
          try {
            const parsed = JSON.parse(data.toString());
            this.emit(parsed.event, parsed.payload);
          } catch (_) {}
        }
      });

      this.ws.on('close', () => {
        this.connected = false;
        console.log('[Pipecat Bridge]: Disconnected from Pipecat Realtime Layer. Scheduling reconnect...');
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        this.connected = false;
        // Non-fatal error log (legacy voice engine remains active)
        this.scheduleReconnect();
      });
    } catch (err) {
      this.connected = false;
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (!this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 5000);
    }
  }

  isConnected() {
    return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  startSession(sessionId, guildId, userId, speakerAlias = 'User') {
    if (!this.isConnected()) return false;
    this.activeSessions.set(sessionId, { sessionId, guildId, userId, speakerAlias });

    this.sendJson('SESSION_START', {
      session_id: sessionId,
      guild_id: guildId,
      user_id: userId,
      speaker_alias: speakerAlias
    });
    return true;
  }

  startTurn(sessionId, turnId) {
    if (!this.isConnected()) return false;
    const session = this.activeSessions.get(sessionId);
    if (session) {
      globalVoiceTelemetry.startTurn(turnId, sessionId, session.guildId, session.speakerAlias);
      this.sendJson('TURN_START', {
        session_id: sessionId,
        turn_id: turnId
      });
      return true;
    }
    return false;
  }

  sendAudioFrame(sessionId, pcmBuffer) {
    if (!this.isConnected() || !pcmBuffer) return false;
    try {
      this.ws.send(pcmBuffer);
      return true;
    } catch (_) {
      return false;
    }
  }

  sendContextStream(sessionId, turnId, tokens) {
    if (!this.isConnected()) return false;
    globalVoiceTelemetry.markTimestamp(turnId, 't6');
    this.sendJson('CONTEXT_TOKEN_STREAM', {
      session_id: sessionId,
      turn_id: turnId,
      tokens
    });
    return true;
  }

  interruptTurn(sessionId, turnId) {
    if (!this.isConnected()) return false;
    globalVoiceTelemetry.invalidateTurn(turnId, 'USER_BARGE_IN');
    this.sendJson('INTERRUPT_SIGNAL', {
      session_id: sessionId,
      turn_id: turnId
    });
    return true;
  }

  sendJson(event, payload) {
    if (this.isConnected()) {
      try {
        this.ws.send(JSON.stringify({ event, payload }));
      } catch (_) {}
    }
  }

  on(event, handler) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(handler);
  }

  emit(event, data) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(fn => {
        try { fn(data); } catch (_) {}
      });
    }
  }
}

const globalPipecatBridge = new PipecatBridgeClient();

module.exports = {
  PipecatBridgeClient,
  globalPipecatBridge
};
