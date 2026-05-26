# azan

Plays the azan at local prayer times. Runs as a `systemd` user service via Bun.

## Layout

- `src/index.ts` — Bun script that computes prayer times with `adhan` and plays the audio.
- `config.json` — location, calculation method, madhab, volume, sink, audio paths. **Gitignored** — copy `config.example.json` and edit.
- `audio/` — user-provided mp3s (also gitignored). `audio/azan.mp3` is the default; `audio/azan-fajr.mp3` optionally overrides Fajr.
- `systemd/azan.service` — user-level systemd unit.

## Volume

Volume is the PulseAudio sink volume (`pactl set-sink-volume`). The `volumePercent` field in `config.json` is applied to the configured `audioSink` just before each playback. Adjust there and `systemctl --user restart azan.service`.

If you're on HDMI, remember the TV/receiver has its own independent volume — the total loudness is the product of the device sink volume and the downstream display volume.

## Install

```sh
# clone, then on the device
cp config.example.json config.json
$EDITOR config.json        # set latitude, longitude, timezone, audioSink
mkdir -p audio
# drop azan.mp3 (and optionally azan-fajr.mp3) into ./audio/

bun install
mkdir -p ~/.config/systemd/user
cp systemd/azan.service ~/.config/systemd/user/
loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable --now azan.service
journalctl --user -u azan.service -f
```

## Re-run after editing config

```sh
systemctl --user restart azan.service
```

## Test playback path

The script honors `AZAN_TEST_IN_SECONDS` — set it to fire one playback that many seconds after startup, then resume the normal schedule.

```sh
systemctl --user set-environment AZAN_TEST_IN_SECONDS=60
systemctl --user restart azan.service
# ...azan plays after 60s...
systemctl --user unset-environment AZAN_TEST_IN_SECONDS
systemctl --user restart azan.service
```

## Discovering your PulseAudio sink

```sh
pactl list short sinks
```

Pick the row whose name reflects the output you want (HDMI, ES8388 analog, USB DAC, etc.) and paste it into `audioSink`.
