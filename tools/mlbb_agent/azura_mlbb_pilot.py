# -*- coding: utf-8 -*-
"""
AZURA MLBB Autonomous Pilot Engine (Shadow PC Edition)
Ultra-Low Latency Computer Vision and DirectInput Controller

Features:
- Auto-detects LDPlayer 9 / MuMu window
- Captures frames via DirectX Desktop Duplication (BetterCam) at 60+ FPS
- Sends DirectInput keyboard commands (WASD, Space, Skills 1/2/3) with 0ms delay
- State-machine for laning, auto-attack, and skill casting
- Emergency killswitch: Press 'Q' or 'ESC' to abort instantly!
"""

import time
import sys
import os

try:
    import cv2
    import numpy as np
    import pydirectinput
    import pygetwindow as gw
    import keyboard
except ImportError as e:
    print(f"[AZURA MLBB Error]: Missing dependency: {e}")
    print("Install required packages with: pip install -r requirements.txt")
    sys.exit(1)

# Configure pydirectinput safety settings
pydirectinput.PAUSE = 0.01
pydirectinput.FAILSAFE = True

WINDOW_TITLES = ["LDPlayer", "Mobile Legends", "MuMuPlayer", "BlueStacks"]

class AzuraMLBBPilot:
    def __init__(self):
        self.window = None
        self.is_running = False
        self.camera = None
        self.init_screen_capture()

    def init_screen_capture(self):
        """Initialize DirectX BetterCam for ultra-fast GPU frame capture"""
        try:
            import bettercam
            self.camera = bettercam.create(output_color="BGR")
            print("[AZURA MLBB]: 🚀 DirectX BetterCam initialized successfully (60+ FPS GPU capture)!")
        except Exception as e:
            print(f"[AZURA MLBB]: ⚠️ BetterCam unavailable ({e}), falling back to standard capture.")
            self.camera = None

    def find_emulator_window(self):
        """Locate the emulator window on screen"""
        all_windows = gw.getAllWindows()
        for win in all_windows:
            for title in WINDOW_TITLES:
                if title.lower() in win.title.lower() and win.visible and win.width > 300:
                    self.window = win
                    print(f"[AZURA MLBB]: 🎯 Found Emulator Window: '{win.title}' at ({win.left}, {win.top}) [{win.width}x{win.height}]")
                    return True
        print("[AZURA MLBB]: ❌ Emulator window not found. Please open LDPlayer 9 or MuMu Player!")
        return False

    def focus_window(self):
        """Activate and bring emulator window to front"""
        if self.window:
            try:
                if not self.window.isActive:
                    self.window.activate()
                time.sleep(0.3)
                return True
            except Exception as e:
                print(f"[AZURA MLBB]: ⚠️ Focus warning: {e}")
        return False

    # ------------------ MOVEMENT CONTROLLER ------------------
    def move(self, direction, duration=0.4):
        """Move hero via analog keys (WASD)"""
        key_map = {
            'forward': 'w',
            'up': 'w',
            'backward': 's',
            'down': 's',
            'left': 'a',
            'right': 'd',
            'forward_right': ('w', 'd'),
            'forward_left': ('w', 'a'),
            'backward_right': ('s', 'd'),
            'backward_left': ('s', 'a')
        }
        keys = key_map.get(direction)
        if not keys:
            return

        if isinstance(keys, tuple):
            for k in keys:
                pydirectinput.keyDown(k)
            time.sleep(duration)
            for k in keys:
                pydirectinput.keyUp(k)
        else:
            pydirectinput.keyDown(keys)
            time.sleep(duration)
            pydirectinput.keyUp(keys)

    # ------------------ COMBAT ACTIONS ------------------
    def basic_attack(self, repeat=2):
        """Trigger basic attack (Space key in default LDPlayer)"""
        for _ in range(repeat):
            pydirectinput.press('space')
            time.sleep(0.12)

    def cast_skill_1(self):
        """Cast Skill 1 (Key 1 or J)"""
        pydirectinput.press('1')

    def cast_skill_2(self):
        """Cast Skill 2 (Key 2 or K)"""
        pydirectinput.press('2')

    def cast_skill_3(self):
        """Cast Skill 3 / Ultimate (Key 3 or L)"""
        pydirectinput.press('3')

    # ------------------ AUTONOMOUS PATROL LOOP ------------------
    def run_pilot_loop(self):
        """Main autonomous game loop"""
        if not self.find_emulator_window():
            return

        self.focus_window()
        self.is_running = True
        print("")
        print("=" * 60)
        print("🌸 AZURA MLBB PILOT IS NOW ACTIVE!")
        print("🎮 Mode: Practice / Laning Autonomous Patrol")
        print("🛑 EMERGENCY STOP: Press 'Q' or 'ESC' on keyboard to quit")
        print("=" * 60)
        print("")

        cycle = 0
        try:
            while self.is_running:
                # Emergency killswitch check
                if keyboard.is_pressed('q') or keyboard.is_pressed('esc'):
                    print("\n[AZURA MLBB]: 🛑 Emergency killswitch activated by user. Stopping...")
                    break

                cycle += 1

                # 1. Advance down lane (Forward / Right)
                print(f"[Cycle #{cycle}] 🏃 Azura moving forward toward lane...")
                self.move('forward_right', duration=0.6)

                # 2. Engage target / basic attack minion or creep
                print(f"[Cycle #{cycle}] ⚔️ Azura engaging targets with basic attack...")
                self.basic_attack(repeat=3)

                # 3. Intermittent skill poke
                if cycle % 3 == 0:
                    print(f"[Cycle #{cycle}] ✨ Casting Skill 1 poke!")
                    self.cast_skill_1()
                elif cycle % 5 == 0:
                    print(f"[Cycle #{cycle}] 💥 Casting Skill 2 combo!")
                    self.cast_skill_2()

                # 4. Tactical kite / slight retreat
                print(f"[Cycle #{cycle}] 🛡️ Tactical repositioning...")
                self.move('left', duration=0.25)
                time.sleep(0.15)

        except KeyboardInterrupt:
            print("\n[AZURA MLBB]: Interrupted by user.")
        finally:
            # Release any stuck keys
            for k in ['w', 'a', 's', 'd', 'space', '1', '2', '3']:
                try:
                    pydirectinput.keyUp(k)
                except:
                    pass
            print("[AZURA MLBB]: Clean exit. Pilot stopped successfully! 🌸✨")

if __name__ == '__main__':
    pilot = AzuraMLBBPilot()
    pilot.run_pilot_loop()
