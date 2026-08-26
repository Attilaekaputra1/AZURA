"""
Custom ElevenLabs v3 Text-to-Dialogue WebSocket Adapter
Protocol endpoint: wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input
Voice ID: d15jrIAARvF899pDoC6T (Kak Ceria)
Model ID: eleven_v3
"""

import asyncio
import json
import base64
import websockets
import logging
from typing import AsyncGenerator, Optional

logger = logging.getLogger("ElevenLabsV3DialogueAdapter")

class ElevenLabsV3DialogueAdapter:
    def __init__(self, api_key: str, voice_id: str = "d15jrIAARvF899pDoC6T"):
        self.api_key = api_key
        self.voice_id = voice_id
        self.model_id = "eleven_v3"
        self.endpoint = "wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input"
        self.voice_settings = {
            "stability": 0.38,
            "similarity_boost": 0.80,
            "style": 0.35,
            "use_speaker_boost": True
        }
        self.generation_config = {
            "chunk_length_schedule": [120, 160, 250, 290]
        }
        self.current_ws = None
        self.is_active = False

    async def stream_dialogue(self, text_token_generator: AsyncGenerator[str, None], turn_id: str) -> AsyncGenerator[bytes, None]:
        """
        Stream text tokens into ElevenLabs Text-to-Dialogue WebSocket and yield audio bytes.
        """
        if not self.api_key:
            logger.error("ELEVENLABS_API_KEY is missing!")
            return

        headers = {
            "xi-api-key": self.api_key
        }

        try:
            async with websockets.connect(self.endpoint, extra_headers=headers, ping_interval=20, ping_timeout=20) as ws:
                self.current_ws = ws
                self.is_active = True

                # Step 1: Send Initial Handshake / Beginning of Stream (BOS)
                bos_payload = {
                    "voice_id": self.voice_id,
                    "model_id": self.model_id,
                    "voice_settings": self.voice_settings,
                    "generation_config": self.generation_config,
                    "context_id": turn_id
                }
                await ws.send(json.dumps(bos_payload))
                logger.info(f"[ElevenLabs v3 WS]: Connected & BOS sent for turn {turn_id}")

                # Producer Task: Stream incoming text tokens to WebSocket
                async def sender():
                    try:
                        async for token in text_token_generator:
                            if not self.is_active:
                                break
                            if token:
                                payload = {
                                    "text": token,
                                    "try_trigger_generation": True
                                }
                                await ws.send(json.dumps(payload))
                        # End of Stream (EOS)
                        if self.is_active:
                            await ws.send(json.dumps({"text": ""}))
                    except Exception as e:
                        logger.warning(f"[ElevenLabs v3 Sender Warning]: {e}")

                send_task = asyncio.create_task(sender())

                # Consumer Loop: Read audio chunks from WebSocket
                try:
                    async for raw_msg in ws:
                        if not self.is_active:
                            break

                        msg = json.loads(raw_msg)
                        if "audio" in msg and msg["audio"]:
                            audio_bytes = base64.b64decode(msg["audio"])
                            yield audio_bytes

                        if msg.get("isFinal"):
                            logger.info(f"[ElevenLabs v3 WS]: Received isFinal signal for turn {turn_id}")
                            break
                finally:
                    self.is_active = False
                    if not send_task.done():
                        send_task.cancel()

        except websockets.exceptions.ConnectionClosed as e:
            logger.info(f"[ElevenLabs v3 WS]: Connection closed: {e}")
        except Exception as e:
            logger.error(f"[ElevenLabs v3 WS Error]: {e}")
            raise e
        finally:
            self.is_active = False
            self.current_ws = None

    def cancel_active_stream(self, turn_id: str):
        """
        Cancel the ongoing dialogue synthesis immediately on interruption / barge-in.
        """
        self.is_active = False
        if self.current_ws:
            try:
                # Send close_context or terminate
                asyncio.create_task(self.current_ws.close())
            except Exception:
                pass
        logger.info(f"[ElevenLabs v3 WS]: Canceled active stream for turn {turn_id}")
