/**
 * Web Audio API synthesizer fallback for Tetris SFX.
 * Guarantees crisp, pleasant, musical feedback even before asset buffers
 * finish decoding or if an audio file fails to load.
 */

export type SfxKey =
  | 'move'
  | 'rotate'
  | 'slam'
  | 'hold'
  | 'lock'
  | 'clear1'
  | 'clear2'
  | 'clear3'
  | 'tetris'
  | 'levelUp'
  | 'gameOver'
  | 'uiClick';

const ALL_SFX_KEYS: readonly SfxKey[] = [
  'move',
  'rotate',
  'slam',
  'hold',
  'lock',
  'clear1',
  'clear2',
  'clear3',
  'tetris',
  'levelUp',
  'gameOver',
  'uiClick',
];

export function isSfxKey(key: string): key is SfxKey {
  return (ALL_SFX_KEYS as readonly string[]).includes(key);
}

interface ToneOptions {
  type?: OscillatorType;
  startFreq: number;
  endFreq?: number;
  startTime: number;
  duration: number;
  peakGain: number;
  attack?: number;
  filterFreq?: number;
}

function playTone(
  ctx: AudioContext,
  destination: AudioNode,
  opts: ToneOptions
): void {
  const {
    type = 'sine',
    startFreq,
    endFreq = startFreq,
    startTime,
    duration,
    peakGain,
    attack = 0.008,
    filterFreq,
  } = opts;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, startFreq), startTime);
  if (endFreq !== startFreq) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(20, endFreq),
      startTime + duration
    );
  }

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(Math.max(0.0002, peakGain), startTime + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  if (filterFreq) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, startTime);
    osc.connect(filter);
    filter.connect(gain);
  } else {
    osc.connect(gain);
  }

  gain.connect(destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

function playNoiseBurst(
  ctx: AudioContext,
  destination: AudioNode,
  startTime: number,
  duration: number,
  filterFreq: number,
  peakGain: number
): void {
  const sampleCount = Math.max(128, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < sampleCount; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / sampleCount);
  }

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(filterFreq, startTime);
  filter.Q.setValueAtTime(1.1, startTime);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(Math.max(0.0002, peakGain), startTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(destination);

  src.start(startTime);
  src.stop(startTime + duration + 0.02);
}

export function playSynthSfx(
  ctx: AudioContext,
  destination: AudioNode,
  key: SfxKey
): void {
  const now = ctx.currentTime;

  switch (key) {
    case 'move': {
      playTone(ctx, destination, {
        type: 'triangle',
        startFreq: 520,
        endFreq: 390,
        startTime: now,
        duration: 0.04,
        peakGain: 0.14,
        attack: 0.003,
        filterFreq: 1600,
      });
      break;
    }

    case 'rotate': {
      playTone(ctx, destination, {
        type: 'sine',
        startFreq: 480,
        endFreq: 720,
        startTime: now,
        duration: 0.065,
        peakGain: 0.18,
        attack: 0.004,
      });
      playTone(ctx, destination, {
        type: 'triangle',
        startFreq: 960,
        endFreq: 1180,
        startTime: now + 0.01,
        duration: 0.045,
        peakGain: 0.06,
        attack: 0.004,
      });
      break;
    }

    case 'slam': {
      // Warm deep thud + soft airy whoosh
      playTone(ctx, destination, {
        type: 'sine',
        startFreq: 165,
        endFreq: 46,
        startTime: now,
        duration: 0.14,
        peakGain: 0.34,
        attack: 0.004,
      });
      playTone(ctx, destination, {
        type: 'triangle',
        startFreq: 260,
        endFreq: 75,
        startTime: now,
        duration: 0.09,
        peakGain: 0.16,
        attack: 0.003,
        filterFreq: 700,
      });
      playNoiseBurst(ctx, destination, now, 0.075, 420, 0.12);
      break;
    }

    case 'hold': {
      playTone(ctx, destination, {
        type: 'sine',
        startFreq: 523.25, // C5
        startTime: now,
        duration: 0.08,
        peakGain: 0.16,
      });
      playTone(ctx, destination, {
        type: 'sine',
        startFreq: 659.25, // E5
        startTime: now + 0.045,
        duration: 0.1,
        peakGain: 0.15,
      });
      break;
    }

    case 'lock': {
      playTone(ctx, destination, {
        type: 'triangle',
        startFreq: 210,
        endFreq: 125,
        startTime: now,
        duration: 0.065,
        peakGain: 0.16,
        attack: 0.003,
        filterFreq: 850,
      });
      break;
    }

    case 'clear1': {
      const notes = [523.25, 659.25]; // C5, E5
      notes.forEach((freq, idx) => {
        playTone(ctx, destination, {
          type: 'sine',
          startFreq: freq,
          startTime: now + idx * 0.055,
          duration: 0.22,
          peakGain: 0.2,
          attack: 0.008,
        });
      });
      break;
    }

    case 'clear2': {
      const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
      notes.forEach((freq, idx) => {
        playTone(ctx, destination, {
          type: 'sine',
          startFreq: freq,
          startTime: now + idx * 0.055,
          duration: 0.26,
          peakGain: 0.2,
          attack: 0.008,
        });
      });
      break;
    }

    case 'clear3': {
      const notes = [523.25, 659.25, 783.99, 987.77]; // C5, E5, G5, B5
      notes.forEach((freq, idx) => {
        playTone(ctx, destination, {
          type: 'sine',
          startFreq: freq,
          startTime: now + idx * 0.05,
          duration: 0.3,
          peakGain: 0.2,
          attack: 0.008,
        });
      });
      break;
    }

    case 'tetris': {
      // Shimmering cosmic Major 9 arpeggio + warm bass bloom
      playTone(ctx, destination, {
        type: 'sine',
        startFreq: 130.81, // C3
        startTime: now,
        duration: 0.55,
        peakGain: 0.22,
        attack: 0.015,
      });
      const notes = [523.25, 659.25, 783.99, 987.77, 1174.66]; // C5 E5 G5 B5 D6
      notes.forEach((freq, idx) => {
        playTone(ctx, destination, {
          type: 'triangle',
          startFreq: freq,
          startTime: now + idx * 0.048,
          duration: 0.42,
          peakGain: 0.18,
          attack: 0.01,
          filterFreq: 3400,
        });
        playTone(ctx, destination, {
          type: 'sine',
          startFreq: freq * 2,
          startTime: now + idx * 0.048 + 0.02,
          duration: 0.3,
          peakGain: 0.06,
          attack: 0.01,
        });
      });
      break;
    }

    case 'levelUp': {
      const notes = [523.25, 587.33, 659.25, 783.99, 880, 1046.5]; // Pentatonic climb
      notes.forEach((freq, idx) => {
        playTone(ctx, destination, {
          type: 'sine',
          startFreq: freq,
          startTime: now + idx * 0.06,
          duration: 0.34,
          peakGain: 0.18,
          attack: 0.01,
        });
      });
      break;
    }

    case 'gameOver': {
      const notes = [440, 392, 349.23, 293.66]; // Gentle warm descent
      notes.forEach((freq, idx) => {
        playTone(ctx, destination, {
          type: 'sine',
          startFreq: freq,
          startTime: now + idx * 0.14,
          duration: 0.45,
          peakGain: 0.18,
          attack: 0.015,
        });
      });
      break;
    }

    case 'uiClick': {
      playTone(ctx, destination, {
        type: 'sine',
        startFreq: 860,
        endFreq: 720,
        startTime: now,
        duration: 0.032,
        peakGain: 0.12,
        attack: 0.002,
      });
      break;
    }
  }
}
