/**
 * Play a subtle ring sound using Web Audio API
 * Creates a pleasant, gentle bell-like tone
 */
let audioContext: AudioContext | null = null;

const getAudioContext = () => {
  if (!audioContext) {
    const Ctor =
      window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new Error('Web Audio API not supported');
    audioContext = new Ctor();
  }
  return audioContext;
};

/** Sound configuration options */
export interface SoundConfig {
  /** Number of bell strikes */
  numBeeps?: number;
  /** Time between strikes in seconds */
  beepInterval?: number;
  /** Frequency in Hz (default: 880 = A5) */
  pitch?: number;
  /** Maximum volume (0-1, default: 0.4) */
  volume?: number;
  /** Attack time in seconds (default: 0.008) */
  attackTime?: number;
  /** Decay time in seconds (default: 1.4) */
  decayTime?: number;
}

/** Default sound configuration */
const DEFAULT_SOUND_CONFIG: Required<SoundConfig> = {
  numBeeps: 1,
  beepInterval: 0.6,
  pitch: 780,
  volume: 0.4,
  attackTime: 0.008,
  decayTime: 1.4,
};

/** Play a configurable bell tone. Returns a promise that resolves when audio starts (or fails silently). */
export const playRingSound = (config: SoundConfig = {}): void => {
  try {
    const ctx = getAudioContext();
    const cfg = { ...DEFAULT_SOUND_CONFIG, ...config };

    const resume = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
    resume
      .then(() => {
        // Play bell strikes at the configured intervals
        Array.from({ length: cfg.numBeeps }, (_, i) => i * cfg.beepInterval).forEach((offset) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.frequency.setValueAtTime(cfg.pitch, ctx.currentTime + offset);
          osc.type = 'sine';

          const t0 = ctx.currentTime + offset;
          gain.gain.setValueAtTime(0, t0);
          gain.gain.linearRampToValueAtTime(cfg.volume, t0 + cfg.attackTime);
          gain.gain.exponentialRampToValueAtTime(0.001, t0 + cfg.decayTime);

          osc.start(t0);
          osc.stop(t0 + cfg.decayTime);
          osc.addEventListener('ended', () => {
            osc.disconnect();
            gain.disconnect();
          });
        });
      })
      .catch(() => {
        /* blocked */
      });
  } catch (error) {
    console.debug('Could not play ring sound:', error);
  }
};

/**
 * Initialize audio context on user interaction to work around browser autoplay policies
 */
export const initAudioContext = () => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
  } catch (error) {
    console.debug('Could not initialize audio context:', error);
  }
};
