import { Coordinates, CalculationMethod, PrayerTimes, Madhab, Prayer } from "adhan";
import { spawn } from "bun";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type Config = {
  latitude: number;
  longitude: number;
  timezone: string;
  method: keyof typeof CalculationMethod;
  madhab: "Shafi" | "Hanafi";
  volumePercent: number;
  audioSink?: string;
  audio: { default: string; fajr?: string };
};

const config: Config = await Bun.file(resolve(ROOT, "config.json")).json();

const PRAYERS: Exclude<Prayer, Prayer.None | Prayer.Sunrise>[] = [
  Prayer.Fajr,
  Prayer.Dhuhr,
  Prayer.Asr,
  Prayer.Maghrib,
  Prayer.Isha,
];

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), ...args);
}

function buildParams() {
  const factory = CalculationMethod[config.method] as () => ReturnType<typeof CalculationMethod.MoonsightingCommittee>;
  const params = factory();
  params.madhab = config.madhab === "Hanafi" ? Madhab.Hanafi : Madhab.Shafi;
  return params;
}

function getTimes(date: Date) {
  const coords = new Coordinates(config.latitude, config.longitude);
  return new PrayerTimes(coords, date, buildParams());
}

function formatLocal(d: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: config.timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

async function setSinkVolume(sink: string, percent: number) {
  const target = sink || "@DEFAULT_SINK@";
  await spawn({ cmd: ["pactl", "set-sink-mute", target, "0"] }).exited;
  const code = await spawn({
    cmd: ["pactl", "set-sink-volume", target, `${percent}%`],
    stdout: "inherit",
    stderr: "inherit",
  }).exited;
  if (code !== 0) log(`pactl set-sink-volume exited ${code}`);
}

async function playAzan(prayer: Prayer) {
  const file = prayer === Prayer.Fajr && config.audio.fajr ? config.audio.fajr : config.audio.default;
  const path = resolve(ROOT, file);
  if (!existsSync(path)) {
    log(`audio file missing: ${path}`);
    return;
  }
  const volume = Math.max(0, Math.min(100, config.volumePercent));
  const sink = config.audioSink ?? "";
  await setSinkVolume(sink, volume);
  const cmd = ["mpg123", "-q", "-o", "pulse"];
  if (sink) cmd.push("-a", sink);
  cmd.push(path);
  log(`playing ${prayer} azan at sink volume ${volume}% from ${path}`);
  const proc = spawn({
    cmd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  log(`mpg123 exited with code ${code}`);
}

function nextPrayerForDate(times: PrayerTimes, now: Date): { prayer: Prayer; at: Date } | null {
  for (const p of PRAYERS) {
    const t = times.timeForPrayer(p);
    if (t && t.getTime() > now.getTime()) return { prayer: p, at: t };
  }
  return null;
}

function findNext(now: Date): { prayer: Prayer; at: Date } {
  const today = getTimes(now);
  const next = nextPrayerForDate(today, now);
  if (next) return next;
  // roll forward to next day's Fajr
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const t2 = getTimes(tomorrow);
  return { prayer: Prayer.Fajr, at: t2.fajr };
}

function logTodaysSchedule() {
  const now = new Date();
  const t = getTimes(now);
  log("today's prayer times:");
  for (const p of PRAYERS) {
    const time = t.timeForPrayer(p);
    if (time) log(`  ${p.padEnd(8)} ${formatLocal(time)}`);
  }
}

async function loop() {
  logTodaysSchedule();
  const testSec = Number(process.env.AZAN_TEST_IN_SECONDS ?? 0);
  if (testSec > 0) {
    log(`TEST MODE: playing in ${testSec}s, then resuming normal schedule`);
    await Bun.sleep(testSec * 1000);
    await playAzan(Prayer.Dhuhr);
    log("TEST MODE: playback finished, entering normal schedule");
  }
  while (true) {
    const now = new Date();
    const next = findNext(now);
    const waitMs = next.at.getTime() - now.getTime();
    log(`next: ${next.prayer} at ${formatLocal(next.at)} (in ${Math.round(waitMs / 1000)}s)`);
    if (waitMs > 0) {
      await Bun.sleep(waitMs);
    }
    try {
      await playAzan(next.prayer);
    } catch (err) {
      log("playback error:", err);
    }
    // small gap to ensure we move past the scheduled time
    await Bun.sleep(2000);
    // If a new day rolled over since logging, print fresh schedule
    const after = new Date();
    if (after.toDateString() !== now.toDateString()) {
      logTodaysSchedule();
    }
  }
}

await loop();
