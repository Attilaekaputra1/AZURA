"""
Custom ElevenLabs v3 Text-to-Dialogue WebSocket Adapter with OpenAI Nova Fallback
Endpoint: wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input
Voice ID: d15jrIAARvF899pDoC6T (Kak Ceria)
Model ID: eleven_v3
"""

import asyncio
import json
import base64
import os
import logging
from typing import AsyncGenerator, Optional, Dict
import websockets
from openai import AsyncOpenAI

logger = logging.getLogger("ElevenLabsV3Adapter")

class CustomElevenLabsV3Adapter:
    def __init__(self, eleven_key: str = None, openai_key: str = None, voice_id: str = "d15jrIAARvF899pDoC6T", default_model: str = "eleven_flash_v2_5"):
        self.eleven_key = eleven_key or os.getenv("ELEVENLABS_API_KEY", "")
        self.openai_key = openai_key or os.getenv("OPENAI_API_KEY", "")
        self.voice_id = voice_id
        self.default_model = default_model
        self.endpoint = "wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input"
        self.generation_config = {
            "chunk_length_schedule": [120, 160, 250, 290]
        }
        self.active_connections: Dict[str, websockets.WebSocketClientProtocol] = {}
        self.cancelled_turns = set()
        self.openai_client = AsyncOpenAI(api_key=self.openai_key) if self.openai_key else None

    def get_voice_settings_for_model(self, model_id: str):
        if model_id == "eleven_flash_v2_5":
            return { "stability": 0.50, "similarity_boost": 0.75, "style": 0.0, "use_speaker_boost": True }
        elif model_id == "eleven_multilingual_v2":
            return { "stability": 0.65, "similarity_boost": 0.80, "style": 0.15, "use_speaker_boost": True }
        else: # eleven_v3
            return { "stability": 0.38, "similarity_boost": 0.80, "style": 0.35, "use_speaker_boost": True }

    async def stream_dialogue(
        self,
        token_stream: AsyncGenerator[str, None],
        turn_id: str,
        model_id: str = None
    ) -> AsyncGenerator[Dict, None]:
        """
        Stream text tokens into ElevenLabs WebSocket with Dynamic Model Routing (Flash v2.5 / v3 / Multilingual v2).
        Yields dict with { "audio": bytes, "provider": str, "turn_id": turn_id }
        Guarantees EXACTLY ONE provider generates valid audio per turn.
        """
        selected_model = model_id or self.default_model
        voice_settings = self.get_voice_settings_for_model(selected_model)
        if turn_id in self.cancelled_turns:
            logger.info(f"[TTS Adapter]: Turn {turn_id} already cancelled before start.")
            return

        accumulated_text = []
        eleven_success = False
        headers = { "xi-api-key": self.eleven_key }

        # Attempt 1: ElevenLabs v3 Text-to-Dialogue WebSocket
        if self.eleven_key:
            try:
                async with websockets.connect(
                    self.endpoint,
                    extra_headers=headers,
                    ping_interval=15,
                    ping_timeout=15,
                    open_timeout=5
                ) as ws:
                    self.active_connections[turn_id] = ws
                    
                    # Handshake / Beginning of Stream (BOS)
                    bos = {
                        "voice_id": self.voice_id,
                        "model_id": selected_model,
                        "voice_settings": voice_settings,
                        "generation_config": self.generation_config,
                        "context_id": turn_id
                    }
                    await ws.send(json.dumps(bos))
                    logger.info(f"[ElevenLabs WS]: Connected & Handshake sent for turn {turn_id} (Model: {selected_model})")

                    # Sender Task
                    async def sender():
                        try:
                            async for token in token_stream:
                                if turn_id in self.cancelled_turns:
                                    break
                                if token:
                                    accumulated_text.append(token)
                                    await ws.send(json.dumps({
                                        "text": token,
                                        "try_trigger_generation": True
                                    }))
                            if turn_id not in self.cancelled_turns:
                                await ws.send(json.dumps({ "text": "" }))
                        except Exception as e:
                            logger.warning(f"[ElevenLabs Sender Task Error]: {e}")

                    send_task = asyncio.create_task(sender())

                    # Receiver Loop
                    try:
                        async for raw_msg in ws:
                            if turn_id in self.cancelled_turns:
                                logger.info(f"[ElevenLabs v3 WS]: Dropping audio frame due to cancellation of turn {turn_id}")
                                break

                            msg = json.loads(raw_msg)
                            if "audio" in msg and msg["audio"]:
                                audio_bytes = base64.b64decode(msg["audio"])
                                eleven_success = True
                                yield {
                                    "audio": audio_bytes,
                                    "provider": "elevenlabs_v3",
                                    "turn_id": turn_id,
                                    "is_first_chunk": True if len(accumulated_text) <= 3 else False
                                }

                            if msg.get("isFinal"):
                                break
                    finally:
                        self.active_connections.pop(turn_id, None)
                        if not send_task.done():
                            send_task.cancel()

            except Exception as err:
                logger.warning(f"[ElevenLabs v3 WS Warning]: ElevenLabs failed ({err}). Triggering seamless fallback to OpenAI Nova for turn {turn_id}...")
                eleven_success = False
            finally:
                self.active_connections.pop(turn_id, None)

        # Attempt 2: Fallback to OpenAI Nova (Only if ElevenLabs produced 0 audio frames)
        if not eleven_success and turn_id not in self.cancelled_turns and self.openai_client:
            full_text = "".join(accumulated_text).strip()
            if not full_text:
                # Read remainder of token stream if sender didn't consume it
                async for token in token_stream:
                    if token:
                        accumulated_text.append(token)
                full_text = "".join(accumulated_text).strip()

            if full_text and turn_id not in self.cancelled_turns:
                logger.info(f"[Fallback Engine]: 🔄 Synthesizing {len(full_text)} chars via OpenAI TTS Nova (Single-Provider Guard)...")
                try:
                    response = await self.openai_client.audio.speech.create(
                        model="tts-1-hd",
                        voice="nova",
                        input=full_text,
                        response_format="pcm"
                    )
                    pcm_data = response.content
                    if turn_id not in self.cancelled_turns and pcm_data:
                        # Yield in chunks
                        chunk_size = 4096
                        for i in range(0, len(pcm_data), chunk_size):
                            if turn_id in self.cancelled_turns:
                                break
                            chunk = pcm_data[i:i + chunk_size]
                            yield {
                                "audio": chunk,
                                "provider": "openai_nova",
                                "turn_id": turn_id,
                                "is_first_chunk": (i == 0)
                            }
                except Exception as fb_err:
                    logger.error(f"[OpenAI Nova Fallback Error]: {fb_err}")

    def cancel_turn(self, turn_id: str):
        """
        Cancel turn immediately on interruption / barge-in.
        """
        self.cancelled_turns.add(turn_id)
        ws = self.active_connections.pop(turn_id, None)
        if ws:
            try:
                asyncio.create_task(ws.close())
            except Exception:
                pass
        logger.info(f"[TTS Adapter]: 🛑 Cancelled active synthesis for turn {turn_id}")
