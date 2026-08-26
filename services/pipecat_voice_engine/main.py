"""
AZURA Pipecat Realtime Voice Engine Microservice (Phase 2)
Protocol: WebSocket Bridge on ws://127.0.0.1:8765
State Machine: IDLE, LISTENING, PROCESSING_STT, PROCESSING_LLM, SYNTHESIZING, PLAYING, CANCELLING, COMPLETED, INVALIDATED, ERROR
"""

import asyncio
import json
import os
import io
import wave
import logging
from typing import Dict, Optional, AsyncGenerator
import websockets
from openai import AsyncOpenAI
from custom_elevenlabs_v3 import CustomElevenLabsV3Adapter

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("PipecatVoiceEngine")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
VOICE_PORT = int(os.getenv("AZURA_PIPECAT_PORT", "8765"))

class VoiceTurnState:
    def __init__(self, turn_id: str, session_id: str, guild_id: str, user_id: str):
        self.turn_id = turn_id
        self.session_id = session_id
        self.guild_id = guild_id
        self.user_id = user_id
        self.state = "IDLE"  # IDLE, LISTENING, PROCESSING_STT, PROCESSING_LLM, SYNTHESIZING, PLAYING, CANCELLING, COMPLETED, INVALIDATED, ERROR
        self.audio_buffer = bytearray()
        self.token_queue = asyncio.Queue()
        self.is_cancelled = False
        self.active_provider = None

class VoiceSessionState:
    def __init__(self, session_id: str, guild_id: str, channel_id: str, user_id: str):
        self.session_id = session_id
        self.guild_id = guild_id
        self.channel_id = channel_id
        self.user_id = user_id
        self.current_turn: Optional[VoiceTurnState] = None
        self.active_turns: Dict[str, VoiceTurnState] = {}

class PipecatBridgeServer:
    def __init__(self, host: str = "127.0.0.1", port: int = 8765):
        self.host = host
        self.port = port
        self.sessions: Dict[str, VoiceSessionState] = {}
        self.openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None
        self.tts_adapter = CustomElevenLabsV3Adapter(
            eleven_key=ELEVENLABS_API_KEY,
            openai_key=OPENAI_API_KEY,
            voice_id="d15jrIAARvF899pDoC6T"
        )

    def pcm_to_wav_bytes(self, pcm_data: bytes, sample_rate: int = 48000, channels: int = 2, sampwidth: int = 2) -> bytes:
        wav_io = io.BytesIO()
        with wave.open(wav_io, 'wb') as wav_file:
            wav_file.setnchannels(channels)
            wav_file.setsampwidth(sampwidth)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(pcm_data)
        wav_io.seek(0)
        return wav_io.read()

    async def transcribe_whisper(self, pcm_bytes: bytes) -> str:
        """
        OpenAI Whisper REST API transcription with temperature=0.0
        """
        if not self.openai_client or len(pcm_bytes) < 4000:
            return ""

        try:
            wav_bytes = self.pcm_to_wav_bytes(pcm_bytes, 48000, 2, 2)
            audio_file = ("speech.wav", io.BytesIO(wav_bytes), "audio/wav")
            
            transcript_obj = await self.openai_client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                language="id",
                temperature=0.0,
                prompt="Percakapan santai di Discord voice channel bersama Attila dan teman-teman tanpa subtitle video."
            )
            return (transcript_obj.text or "").strip()
        except Exception as e:
            logger.error(f"[Whisper STT Error]: {e}")
            return ""

    async def handle_connection(self, websocket):
        logger.info(f"[Pipecat Bridge]: Connected to Node.js Master from {websocket.remote_address}")
        current_session: Optional[VoiceSessionState] = None

        try:
            async for message in websocket:
                if isinstance(message, str):
                    try:
                        data = json.loads(message)
                        event = data.get("event")
                        payload = data.get("payload", {})

                        if event == "SESSION_START":
                            session_id = payload.get("session_id")
                            guild_id = payload.get("guild_id")
                            channel_id = payload.get("channel_id", "")
                            user_id = payload.get("user_id")
                            current_session = VoiceSessionState(session_id, guild_id, channel_id, user_id)
                            self.sessions[session_id] = current_session
                            logger.info(f"[Session Init]: 🎙️ Session {session_id} created for user {user_id}")
                            await websocket.send(json.dumps({
                                "event": "SESSION_READY",
                                "payload": { "session_id": session_id, "status": "READY" }
                            }))

                        elif event == "TURN_START":
                            turn_id = payload.get("turn_id")
                            if current_session:
                                turn = VoiceTurnState(turn_id, current_session.session_id, current_session.guild_id, current_session.user_id)
                                turn.state = "LISTENING"
                                current_session.current_turn = turn
                                current_session.active_turns[turn_id] = turn
                                logger.info(f"[Turn Lifecycle]: 🟢 Turn {turn_id} -> LISTENING")

                        elif event == "SPEECH_END":
                            turn_id = payload.get("turn_id")
                            turn = current_session.active_turns.get(turn_id) if current_session else None
                            if turn and not turn.is_cancelled:
                                turn.state = "PROCESSING_STT"
                                logger.info(f"[Turn Lifecycle]: 🔍 Turn {turn_id} -> PROCESSING_STT ({len(turn.audio_buffer)} bytes)")
                                
                                # Transcribe using Whisper
                                text = await self.transcribe_whisper(bytes(turn.audio_buffer))
                                if not turn.is_cancelled:
                                    turn.state = "PROCESSING_LLM"
                                    logger.info(f"[Whisper Transcript]: Turn {turn_id} -> \"{text}\"")
                                    await websocket.send(json.dumps({
                                        "event": "TRANSCRIPT_READY",
                                        "payload": {
                                            "turn_id": turn_id,
                                            "session_id": current_session.session_id,
                                            "transcript": text
                                        }
                                    }))

                        elif event == "TOKEN_CHUNK":
                            turn_id = payload.get("turn_id")
                            token = payload.get("token", "")
                            is_last = payload.get("is_last", False)
                            turn = current_session.active_turns.get(turn_id) if current_session else None
                            if turn and not turn.is_cancelled:
                                await turn.token_queue.put(token)
                                if is_last:
                                    await turn.token_queue.put(None) # Signal EOF

                        elif event == "START_SYNTHESIS":
                            turn_id = payload.get("turn_id")
                            turn = current_session.active_turns.get(turn_id) if current_session else None
                            if turn and not turn.is_cancelled:
                                turn.state = "SYNTHESIZING"
                                logger.info(f"[Turn Lifecycle]: 🔊 Turn {turn_id} -> SYNTHESIZING")

                                async def token_generator():
                                    while True:
                                        t = await turn.token_queue.get()
                                        if t is None:
                                            break
                                        yield t

                                async def synthesize_and_stream():
                                    try:
                                        async for chunk in self.tts_adapter.stream_dialogue(token_generator(), turn_id):
                                            if turn.is_cancelled:
                                                logger.info(f"[Audio Stream]: Dropping audio frame due to cancellation of turn {turn_id}")
                                                break
                                            
                                            turn.state = "PLAYING"
                                            turn.active_provider = chunk.get("provider")
                                            audio_bytes = chunk.get("audio", b"")
                                            
                                            # Send audio chunk to Node.js Master
                                            await websocket.send(json.dumps({
                                                "event": "AUDIO_CHUNK_HEADER",
                                                "payload": {
                                                    "turn_id": turn_id,
                                                    "provider": turn.active_provider,
                                                    "is_first_chunk": chunk.get("is_first_chunk", False)
                                                }
                                            }))
                                            await websocket.send(audio_bytes)

                                        if not turn.is_cancelled:
                                            turn.state = "COMPLETED"
                                            logger.info(f"[Turn Lifecycle]: ✅ Turn {turn_id} -> COMPLETED (Provider: {turn.active_provider})")
                                            await websocket.send(json.dumps({
                                                "event": "TURN_COMPLETED",
                                                "payload": { "turn_id": turn_id, "provider": turn.active_provider }
                                            }))
                                    except Exception as e:
                                        logger.error(f"[Synthesis Task Error]: {e}")
                                        turn.state = "ERROR"

                                asyncio.create_task(synthesize_and_stream())

                        elif event == "INTERRUPT_SIGNAL":
                            turn_id = payload.get("turn_id")
                            turn = current_session.active_turns.get(turn_id) if current_session else None
                            if turn:
                                logger.info(f"[Barge-In]: ⚠️ Cancelling active turn {turn_id}")
                                turn.is_cancelled = True
                                turn.state = "INVALIDATED"
                                self.tts_adapter.cancel_turn(turn_id)
                                turn.audio_buffer.clear()
                                await websocket.send(json.dumps({
                                    "event": "INTERRUPT_ACK",
                                    "payload": { "turn_id": turn_id, "status": "INVALIDATED" }
                                }))

                    except json.JSONDecodeError:
                        logger.warning("[Pipecat Bridge]: Invalid JSON text received.")

                elif isinstance(message, bytes):
                    # Binary PCM Audio Stream from Discord
                    if current_session and current_session.current_turn and not current_session.current_turn.is_cancelled:
                        current_session.current_turn.audio_buffer.extend(message)

        except websockets.exceptions.ConnectionClosed:
            logger.info("[Pipecat Bridge]: Connection closed.")
        except Exception as e:
            logger.error(f"[Pipecat Bridge Connection Error]: {e}")
        finally:
            if current_session:
                self.sessions.pop(current_session.session_id, None)

    async def start(self):
        logger.info(f"Starting Pipecat Realtime Voice Engine on ws://{self.host}:{self.port}...")
        async with websockets.serve(self.handle_connection, self.host, self.port):
            await asyncio.Future()

if __name__ == "__main__":
    server = PipecatBridgeServer(host="127.0.0.1", port=VOICE_PORT)
    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        logger.info("Pipecat Voice Engine stopped.")
