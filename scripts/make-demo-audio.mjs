/**
 * Writes the short original tracks shipped with the public demo.
 * Run with: node scripts/make-demo-audio.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/demo');
const sampleRate = 22050;

function tone(time, freq, amp = 0.2) {
  return Math.sin(2 * Math.PI * freq * time) * amp;
}

function env(time, duration, attack = 0.02, release = 0.08) {
  if (time < attack) return time / attack;
  if (time > duration - release) return Math.max(0, (duration - time) / release);
  return 1;
}

function writeWav(name, render) {
  const duration = 8;
  const samples = sampleRate * duration;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const time = i / sampleRate;
    const value = Math.max(-1, Math.min(1, render(time, duration)));
    data.writeInt16LE(Math.round(value * 32767), i * 2);
  }
  const buf = Buffer.alloc(44 + data.length);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + data.length, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(data.length, 40);
  data.copy(buf, 44);
  fs.writeFileSync(path.join(outDir, name), buf);
}

const note = (name) => {
  const scale = { C: 261.63, D: 293.66, E: 329.63, F: 349.23, G: 392.0, A: 440.0, B: 493.88 };
  return scale[name];
};

fs.mkdirSync(outDir, { recursive: true });

writeWav('north-window.wav', (time, duration) => {
  const steps = [note('C'), note('E'), note('G'), note('C'), note('E'), note('G'), note('A'), note('G')];
  const step = steps[Math.floor(time * 2) % steps.length];
  return tone(time, step, 0.22) * env(time % 0.5, 0.5) * env(time, duration, 0.05, 0.4);
});

writeWav('night-bus.wav', (time, duration) => {
  const steps = [note('A') / 2, note('E') / 2, note('F') / 2, note('C') / 2];
  const step = steps[Math.floor(time) % steps.length];
  const bass = tone(time, step, 0.2);
  const fifth = tone(time, step * 1.5, 0.08);
  return (bass + fifth) * env(time, duration, 0.1, 0.6);
});

writeWav('kitchen-radio.wav', (time, duration) => {
  const steps = [note('G'), note('B'), note('D'), note('B'), note('G'), note('A'), note('F'), note('E')];
  const step = steps[Math.floor(time * 3) % steps.length];
  const lead = tone(time, step, 0.16) * env(time % (1 / 3), 1 / 3, 0.01, 0.06);
  const bed = tone(time, note('C') / 2, 0.06);
  return (lead + bed) * env(time, duration, 0.04, 0.35);
});

console.log(`Wrote demo tracks to ${outDir}`);
