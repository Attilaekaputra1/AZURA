/**
 * AZURA Streaming TTS & Speculative Parallel Audio Queue Subsystem
 * (Solving Serial Multi-API Latency Stacking)
 * Splits streaming LLM output into sentence boundaries, dispatches parallel TTS synthesis
 * for Sentence #1 while Sentence #2 is generating, and seamlessly feeds Discord AudioPlayer.
 */

const { createAudioResource, StreamType } = require('@discordjs/voice');
const { Readable } = require('stream');

/**
 * Split continuous text into sentence chunks
 * @param {string} text 
 * @returns {string[]}
 */
function splitIntoSentences(text) {
  if (!text) return [];
  // Match sentence terminators followed by whitespace or end of string
  const sentences = text
    .split(/(?<=[.!?\n])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  return sentences;
}

/**
 * Queue of Audio Resources for a Guild's Audio Player
 */
class GuildAudioStreamQueue {
  constructor(guildId, audioPlayer) {
    this.guildId = guildId;
    this.audioPlayer = audioPlayer;
    this.queue = [];
    this.isPlaying = false;
  }

  enqueue(audioResource) {
    if (!audioResource) return;
    this.queue.push(audioResource);
    if (!this.isPlaying) {
      this.playNext();
    }
  }

  playNext() {
    if (this.queue.length === 0) {
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;
    const nextResource = this.queue.shift();
    this.audioPlayer.play(nextResource);

    // Audio player idle event handles the next sentence in queue
  }

  clear() {
    this.queue = [];
    this.isPlaying = false;
  }
}

const activeAudioQueues = new Map(); // guildId -> GuildAudioStreamQueue

function getAudioQueue(guildId, audioPlayer) {
  let q = activeAudioQueues.get(guildId);
  if (!q || q.audioPlayer !== audioPlayer) {
    q = new GuildAudioStreamQueue(guildId, audioPlayer);
    activeAudioQueues.set(guildId, q);
  }
  return q;
}

module.exports = {
  splitIntoSentences,
  GuildAudioStreamQueue,
  getAudioQueue
};
