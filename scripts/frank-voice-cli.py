#!/usr/bin/env python3
"""
Two-way VOICE conversation with Frank (Community Care Line) — entirely in the
terminal, over your Mac's mic + speakers. No browser. Connects to the dark
no-phone test agent, so nothing dials a real resident.

ONE-TIME SETUP:
    brew install portaudio
    pip3 install --user "elevenlabs" pyaudio
    # Grant your terminal app the microphone:
    #   System Settings → Privacy & Security → Microphone → enable Terminal / Warp / iTerm
    #   (first run will also prompt; if it doesn't speak, that permission is why)

RUN (from ~/code/frank-pilot):
    python3 scripts/frank-voice-cli.py
Speak when you hear Frank. Ctrl-C to end the call.
"""
import os
import pathlib
import signal
import sys

AGENT_ID = "agent_0501kv7tctpcec49kq118b3hb7ps"  # Frank — Community Care Line (TEST · no phone)


def load_key():
    key = os.environ.get("ELEVENLABS_API_KEY")
    if key:
        return key
    for env in ("/Users/A13xPeri/code/battlestation/.env",
                str(pathlib.Path.home() / "code/frank-pilot/.env")):
        try:
            for line in open(env):
                if line.startswith("ELEVENLABS_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
        except FileNotFoundError:
            continue
    return None


def main():
    try:
        from elevenlabs.client import ElevenLabs
        from elevenlabs.conversational_ai.conversation import Conversation
        from elevenlabs.conversational_ai.default_audio_interface import DefaultAudioInterface
    except ImportError:
        sys.exit("Missing deps. One-time:\n"
                 "  brew install portaudio\n"
                 "  pip3 install --user elevenlabs pyaudio")

    key = load_key()
    if not key:
        sys.exit("No ELEVENLABS_API_KEY found (env or battlestation/.env).")

    client = ElevenLabs(api_key=key)
    conv = Conversation(
        client,
        AGENT_ID,
        requires_auth=True,  # account-owned (private) agent
        audio_interface=DefaultAudioInterface(),
        callback_agent_response=lambda r: print(f"\nFrank: {r}"),
        callback_user_transcript=lambda t: print(f"You:   {t}"),
    )
    print("Connecting to Frank — speak when you hear him. Ctrl-C to hang up.\n")
    conv.start_session()
    signal.signal(signal.SIGINT, lambda *_: conv.end_session())
    conversation_id = conv.wait_for_session_end()
    print(f"\n(call ended — conversation_id={conversation_id})")


if __name__ == "__main__":
    main()
