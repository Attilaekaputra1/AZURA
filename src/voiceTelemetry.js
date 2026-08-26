/**
 * AZURA Voice Latency Telemetry Engine
 * 
 * High-resolution latency instrumentation for voice turns (T0 to T8).
 * Privacy & Security Guard: Strictly records durations, timestamps, and provider metadata.
 * NEVER stores transcript text or raw audio.
 */

class VoiceTelemetryCollector {
  constructor(maxHistory = 100) {
    this.maxHistory = maxHistory;
    this.activeTurns = new Map(); // turnId -> turnObject
    this.completedTurns = [];     // Ring buffer of completed turn metrics
  }

  /**
   * Start tracking a new voice turn
   * @param {string} turnId 
   * @param {string} sessionId 
   * @param {string} guildId 
   * @param {string} [speakerAlias='User'] 
   */
  startTurn(turnId, sessionId, guildId, speakerAlias = 'User') {
    const now = Date.now();
    const turnData = {
      turn_id: turnId,
      session_id: sessionId,
      guild_id: guildId,
      speaker_alias: speakerAlias,
      timestamps: {
        t0: now, // User speech end / end-of-utterance detection
        t1: null, // VAD speech-end event
        t2: null, // STT request start
        t3: null, // STT response received
        t4: null, // AZURA Core / LLM request start
        t5: null, // First LLM token received
        t6: null, // TTS request/input start
        t7: null, // First TTS audio chunk received
        t8: null  // First Discord audio playback
      },
      metrics_ms: {
        stt_latency: null,
        llm_ttft: null,
        tts_ttfa: null,
        total_ttfa: null
      },
      provider: {
        stt: 'openai_whisper_rest',
        llm: 'gpt-5.6-luna',
        tts: 'elevenlabs_v3'
      },
      status: 'IN_PROGRESS',
      interrupted: false,
      error_category: null,
      started_at: now,
      completed_at: null
    };

    this.activeTurns.set(turnId, turnData);
    return turnData;
  }

  /**
   * Mark a specific timestamp in the turn lifecycle
   * @param {string} turnId 
   * @param {'t0'|'t1'|'t2'|'t3'|'t4'|'t5'|'t6'|'t7'|'t8'} point 
   * @param {number} [customTime] 
   */
  markTimestamp(turnId, point, customTime = null) {
    const turn = this.activeTurns.get(turnId);
    if (!turn) return null;

    const time = customTime || Date.now();
    if (turn.timestamps.hasOwnProperty(point)) {
      turn.timestamps[point] = time;
    }

    // Auto-calculate derived metrics
    const ts = turn.timestamps;
    if (ts.t2 && ts.t3) turn.metrics_ms.stt_latency = Math.max(0, ts.t3 - ts.t2);
    if (ts.t4 && ts.t5) turn.metrics_ms.llm_ttft = Math.max(0, ts.t5 - ts.t4);
    if (ts.t6 && ts.t7) turn.metrics_ms.tts_ttfa = Math.max(0, ts.t7 - ts.t6);
    if (ts.t0 && ts.t8) turn.metrics_ms.total_ttfa = Math.max(0, ts.t8 - ts.t0);

    return turn;
  }

  /**
   * Complete a turn and compute final telemetry metrics
   * @param {string} turnId 
   * @param {object} [meta] 
   */
  finishTurn(turnId, meta = {}) {
    const turn = this.activeTurns.get(turnId);
    if (!turn) return null;

    const now = Date.now();
    turn.completed_at = now;
    turn.status = meta.status || (meta.interrupted ? 'INTERRUPTED' : 'COMPLETED');
    turn.interrupted = !!meta.interrupted;
    turn.error_category = meta.error_category || null;

    if (meta.provider) {
      turn.provider = { ...turn.provider, ...meta.provider };
    }

    // Final calculation pass
    const ts = turn.timestamps;
    if (ts.t2 && ts.t3) turn.metrics_ms.stt_latency = Math.max(0, ts.t3 - ts.t2);
    if (ts.t4 && ts.t5) turn.metrics_ms.llm_ttft = Math.max(0, ts.t5 - ts.t4);
    if (ts.t6 && ts.t7) turn.metrics_ms.tts_ttfa = Math.max(0, ts.t7 - ts.t6);
    if (ts.t0 && ts.t8) turn.metrics_ms.total_ttfa = Math.max(0, ts.t8 - ts.t0);

    this.activeTurns.delete(turnId);

    // Save to ring buffer
    this.completedTurns.push(turn);
    if (this.completedTurns.length > this.maxHistory) {
      this.completedTurns.shift();
    }

    console.log(`[Voice Telemetry]: 📊 Turn ${turnId} [${turn.status}] -> STT: ${turn.metrics_ms.stt_latency || 0}ms | LLM TTFT: ${turn.metrics_ms.llm_ttft || 0}ms | TTS TTFA: ${turn.metrics_ms.tts_ttfa || 0}ms | Total TTFA: ${turn.metrics_ms.total_ttfa || 0}ms`);
    return turn;
  }

  /**
   * Invalidate a turn due to barge-in / interruption
   * @param {string} turnId 
   * @param {string} reason 
   */
  invalidateTurn(turnId, reason = 'BARGE_IN_INTERRUPTION') {
    const turn = this.activeTurns.get(turnId);
    if (!turn) return null;

    return this.finishTurn(turnId, {
      status: 'INVALIDATED',
      interrupted: true,
      error_category: reason
    });
  }

  /**
   * Get telemetry summary across recent turns
   */
  getTelemetrySummary() {
    const valid = this.completedTurns.filter(t => t.status === 'COMPLETED' && t.metrics_ms.total_ttfa !== null);
    if (valid.length === 0) {
      return {
        total_recorded_turns: this.completedTurns.length,
        valid_completed_turns: 0,
        average_total_ttfa_ms: 0,
        average_stt_latency_ms: 0,
        average_llm_ttft_ms: 0,
        average_tts_ttfa_ms: 0
      };
    }

    const sum = (arr, key) => arr.reduce((acc, curr) => acc + (curr.metrics_ms[key] || 0), 0);
    const count = valid.length;

    return {
      total_recorded_turns: this.completedTurns.length,
      valid_completed_turns: count,
      average_total_ttfa_ms: Math.round(sum(valid, 'total_ttfa') / count),
      average_stt_latency_ms: Math.round(sum(valid, 'stt_latency') / count),
      average_llm_ttft_ms: Math.round(sum(valid, 'llm_ttft') / count),
      average_tts_ttfa_ms: Math.round(sum(valid, 'tts_ttfa') / count),
      latest_turn: this.completedTurns[this.completedTurns.length - 1] || null
    };
  }
}

const globalVoiceTelemetry = new VoiceTelemetryCollector(100);

module.exports = {
  VoiceTelemetryCollector,
  globalVoiceTelemetry
};
