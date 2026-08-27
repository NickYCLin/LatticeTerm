/** Short, original Web Audio cues for Agent completion notifications. */

export type NotificationSoundChoice =
  | "off"
  | "clear"
  | "gentle"
  | "double"
  | "wood";

export const notificationSoundChoices: readonly NotificationSoundChoice[] = [
  "off",
  "clear",
  "gentle",
  "double",
  "wood",
];

interface NotificationTone {
  frequency: number;
  delay: number;
  duration: number;
  gain: number;
  type: OscillatorType;
}

export function notificationToneSequence(
  sound: NotificationSoundChoice,
): readonly NotificationTone[] {
  switch (sound) {
    case "clear":
      return [
        { frequency: 880, delay: 0, duration: 0.18, gain: 0.1, type: "sine" },
        { frequency: 1320, delay: 0.13, duration: 0.28, gain: 0.08, type: "sine" },
      ];
    case "gentle":
      return [
        { frequency: 659.25, delay: 0, duration: 0.34, gain: 0.075, type: "sine" },
        { frequency: 783.99, delay: 0.08, duration: 0.42, gain: 0.05, type: "sine" },
      ];
    case "double":
      return [
        { frequency: 740, delay: 0, duration: 0.14, gain: 0.09, type: "triangle" },
        { frequency: 988, delay: 0.2, duration: 0.18, gain: 0.09, type: "triangle" },
      ];
    case "wood":
      return [
        { frequency: 420, delay: 0, duration: 0.09, gain: 0.11, type: "square" },
        { frequency: 315, delay: 0.1, duration: 0.11, gain: 0.065, type: "triangle" },
      ];
    default:
      return [];
  }
}

let sharedContext: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextConstructor = (
    window as typeof window & { webkitAudioContext?: typeof AudioContext }
  ).AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextConstructor) return null;
  sharedContext ??= new AudioContextConstructor();
  return sharedContext;
}

/**
 * Unlocks Web Audio from a real user gesture. WebView2 can otherwise keep a
 * context suspended until long after the user submits work, causing the first
 * background completion cue to be silently rejected.
 */
export async function prepareNotificationAudio(): Promise<boolean> {
  const context = audioContext();
  if (!context) return false;
  try {
    if (context.state === "suspended") await context.resume();
    return context.state === "running";
  } catch {
    return false;
  }
}

/** Plays one short cue. Browser autoplay rejection is intentionally silent. */
export async function playNotificationSound(sound: NotificationSoundChoice) {
  const tones = notificationToneSequence(sound);
  if (tones.length === 0) return;
  const context = audioContext();
  if (!context) return;

  try {
    if (!(await prepareNotificationAudio())) return;
    const start = context.currentTime + 0.015;
    for (const tone of tones) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const toneStart = start + tone.delay;
      const toneEnd = toneStart + tone.duration;
      oscillator.type = tone.type;
      oscillator.frequency.setValueAtTime(tone.frequency, toneStart);
      gain.gain.setValueAtTime(0.0001, toneStart);
      gain.gain.exponentialRampToValueAtTime(tone.gain, toneStart + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, toneEnd);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(toneStart);
      oscillator.stop(toneEnd + 0.01);
    }
  } catch {
    // A platform may block audio until a user gesture. Notifications remain
    // visible in the sidebar even when the cue cannot play.
  }
}
