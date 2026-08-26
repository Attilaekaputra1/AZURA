"""
AZURA Pipecat Realtime Voice Engine Microservice (Phase 1)
Host: 127.0.0.1:8765
Transport: WebSocket Bridge to Node.js AZURA Master Core
"""

import asyncio
import json
import os
import sys
import logging
from typing import Dict
import websockets
from custom_elevenlabs_v3 import ElevenLabsV3DialogueAdapter

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("PipecatVoiceEngine")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
VOICE_PORT = int(os.getenv("AZURA_PIPECAT_PORT", "8765"))

class VoiceSessionState:
    def __init__(self, session_id: str, guild_id: str, user_id: str):
        self.session_id = session_id
        self.guild_id = guild_id
        self.user_id = user_id
        self.current_turn_id = None
        self.pipeline_state = "IDLE"  # IDLE, LISTENING, TRANSCRIBING, GENERATING, COMPLETED, INVALIDATED
        self.audio_buffer = bytearray()
        self.active_adapter = None
        self.is_cancelled = False

class PipecatBridgeServer:
    def __init__(self, host: str = "127.0.0.1", port: int = 8765):
        self.host = host
        self.port = port
        self.sessions: Dict[str, VoiceSessionState] = {}
        self.eleven_adapter = ElevenLabsV3DialogueAdapter(
            api_key=ELEVENLABS_API_KEY,
            voice_id="d15jrIAARvF899pDoC6T"
        )

    async def handle_connection(self, websocket):
        logger.info(f"[Pipecat Bridge]: Node.js Master Bot connected from {websocket.remote_address}")
        current_session: VoiceSessionState = None

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
                            user_id = payload.get("user_id")
                            current_session = VoiceSessionState(session_id, guild_id, user_id)
                            self.sessions[session_id] = current_session
                            logger.info(f"[Pipecat Bridge]: Initialized isolated session: {session_id} for user {user_id}")
                            await websocket.send(json.dumps({
                                "event": "SESSION_READY",
                                "payload": { "session_id": session_id, "status": "READY" }
                            }))

                        elif event == "TURN_START":
                            if current_session:
                                current_session.current_turn_id = payload.get("turn_id")
                                current_session.pipeline_state = "LISTENING"
                                current_session.audio_buffer.clear()
                                current_session.is_cancelled = False
                                logger.info(f"[Pipecat Bridge]: Turn started -> {current_session.current_turn_id}")

                        elif event == "INTERRUPT_SIGNAL":
                            if current_session and current_session.current_turn_id:
                                logger.info(f"[Pipecat Bridge]: ⚠️ INTERRUPT received for turn {current_session.current_turn_id}")
                                current_session.is_cancelled = True
                                current_session.pipeline_state = "INVALIDATED"
                                self.eleven_adapter.cancel_active_stream(current_session.current_turn_id)
                                current_session.audio_buffer.clear()
                                await websocket.send(json.dumps({
                                    "event": "INTERRUPT_ACK",
                                    "payload": { "turn_id": current_session.current_turn_id }
                                }))

                        elif event == "CONTEXT_TOKEN_STREAM":
                            # Stream incoming tokens to ElevenLabs adapter
                            turn_id = payload.get("turn_id")
                            tokens = payload.get("tokens", [])
                            # Handled via turn queue in streaming pipeline

                    except json.JSONDecodeError:
                        logger.warning("[Pipecat Bridge]: Invalid JSON text received.")

                elif isinstance(message, bytes):
                    # Binary PCM Audio Stream from Discord
                    if current_session and not current_session.is_cancelled:
                        current_session.audio_buffer.extend(message)

        except websockets.exceptions.ConnectionClosed:
            logger.info("[Pipecat Bridge]: Node.js connection closed.")
        except Exception as e:
            logger.error(f"[Pipecat Bridge Error]: {e}")
        finally:
            if current_session:
                self.sessions.pop(current_session.session_id, None)

    async def start(self):
        logger.info(f"Starting Pipecat Realtime Voice Engine on ws://{self.host}:{self.port}...")
        async with websockets.serve(self.handle_connection, self.host, self.port):
            await asyncio.Future() # Run forever

if __name__ == "__main__":
    server = PipecatBridgeServer(host="127.0.0.1", port=VOICE_PORT)
    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        logger.info("Pipecat Voice Engine stopped by user.")
