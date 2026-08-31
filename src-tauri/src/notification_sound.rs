const SAMPLE_RATE: u32 = 44_100;
const CHANNELS: u16 = 1;
const BITS_PER_SAMPLE: u16 = 16;

#[derive(Clone, Copy)]
enum Waveform {
    Sine,
    Triangle,
    Square,
}

#[derive(Clone, Copy)]
struct Tone {
    frequency: f32,
    delay_ms: u32,
    duration_ms: u32,
    gain: f32,
    waveform: Waveform,
}

fn tones(sound: &str) -> Result<&'static [Tone], String> {
    const CLEAR: [Tone; 2] = [
        Tone {
            frequency: 880.0,
            delay_ms: 0,
            duration_ms: 180,
            gain: 0.24,
            waveform: Waveform::Sine,
        },
        Tone {
            frequency: 1320.0,
            delay_ms: 130,
            duration_ms: 280,
            gain: 0.19,
            waveform: Waveform::Sine,
        },
    ];
    const GENTLE: [Tone; 2] = [
        Tone {
            frequency: 659.25,
            delay_ms: 0,
            duration_ms: 340,
            gain: 0.2,
            waveform: Waveform::Sine,
        },
        Tone {
            frequency: 783.99,
            delay_ms: 80,
            duration_ms: 420,
            gain: 0.14,
            waveform: Waveform::Sine,
        },
    ];
    const DOUBLE: [Tone; 2] = [
        Tone {
            frequency: 740.0,
            delay_ms: 0,
            duration_ms: 140,
            gain: 0.2,
            waveform: Waveform::Triangle,
        },
        Tone {
            frequency: 988.0,
            delay_ms: 200,
            duration_ms: 180,
            gain: 0.2,
            waveform: Waveform::Triangle,
        },
    ];
    const WOOD: [Tone; 2] = [
        Tone {
            frequency: 420.0,
            delay_ms: 0,
            duration_ms: 90,
            gain: 0.2,
            waveform: Waveform::Square,
        },
        Tone {
            frequency: 315.0,
            delay_ms: 100,
            duration_ms: 110,
            gain: 0.15,
            waveform: Waveform::Triangle,
        },
    ];

    match sound {
        "off" => Ok(&[]),
        "clear" => Ok(&CLEAR),
        "gentle" => Ok(&GENTLE),
        "double" => Ok(&DOUBLE),
        "wood" => Ok(&WOOD),
        _ => Err("Unknown notification sound.".to_string()),
    }
}

fn waveform_sample(waveform: Waveform, phase: f32) -> f32 {
    match waveform {
        Waveform::Sine => phase.sin(),
        Waveform::Triangle => (2.0 / std::f32::consts::PI) * phase.sin().asin(),
        Waveform::Square => {
            if phase.sin() >= 0.0 {
                1.0
            } else {
                -1.0
            }
        }
    }
}

fn render_wave(sound: &str) -> Result<Vec<u8>, String> {
    let tones = tones(sound)?;
    if tones.is_empty() {
        return Ok(Vec::new());
    }

    let duration_ms = tones
        .iter()
        .map(|tone| tone.delay_ms + tone.duration_ms)
        .max()
        .unwrap_or(0)
        + 35;
    let sample_count = ((duration_ms as u64 * SAMPLE_RATE as u64) / 1000) as usize;
    let mut mixed = vec![0.0_f32; sample_count];

    for tone in tones {
        let start = ((tone.delay_ms as u64 * SAMPLE_RATE as u64) / 1000) as usize;
        let length = ((tone.duration_ms as u64 * SAMPLE_RATE as u64) / 1000) as usize;
        let attack = (SAMPLE_RATE as usize * 8 / 1000).max(1);
        let release = (SAMPLE_RATE as usize * 28 / 1000).max(1);
        for offset in 0..length.min(sample_count.saturating_sub(start)) {
            let attack_envelope = (offset as f32 / attack as f32).min(1.0);
            let remaining = length.saturating_sub(offset + 1);
            let release_envelope = (remaining as f32 / release as f32).min(1.0);
            let envelope = attack_envelope.min(release_envelope);
            let phase = std::f32::consts::TAU * tone.frequency * offset as f32 / SAMPLE_RATE as f32;
            mixed[start + offset] += waveform_sample(tone.waveform, phase) * tone.gain * envelope;
        }
    }

    let data_length = (mixed.len() * 2) as u32;
    let mut wave = Vec::with_capacity(44 + data_length as usize);
    wave.extend_from_slice(b"RIFF");
    wave.extend_from_slice(&(36 + data_length).to_le_bytes());
    wave.extend_from_slice(b"WAVEfmt ");
    wave.extend_from_slice(&16_u32.to_le_bytes());
    wave.extend_from_slice(&1_u16.to_le_bytes());
    wave.extend_from_slice(&CHANNELS.to_le_bytes());
    wave.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    let byte_rate = SAMPLE_RATE * u32::from(CHANNELS) * u32::from(BITS_PER_SAMPLE) / 8;
    wave.extend_from_slice(&byte_rate.to_le_bytes());
    let block_align = CHANNELS * BITS_PER_SAMPLE / 8;
    wave.extend_from_slice(&block_align.to_le_bytes());
    wave.extend_from_slice(&BITS_PER_SAMPLE.to_le_bytes());
    wave.extend_from_slice(b"data");
    wave.extend_from_slice(&data_length.to_le_bytes());
    for sample in mixed {
        let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        wave.extend_from_slice(&value.to_le_bytes());
    }
    Ok(wave)
}

#[cfg(target_os = "windows")]
fn play_wave(wave: &[u8]) -> Result<bool, String> {
    use std::ffi::c_void;
    use std::sync::{Mutex, OnceLock};

    const SND_NODEFAULT: u32 = 0x0002;
    const SND_MEMORY: u32 = 0x0004;

    #[link(name = "winmm")]
    unsafe extern "system" {
        fn PlaySoundA(sound: *const u8, module: *mut c_void, flags: u32) -> i32;
    }

    if wave.is_empty() {
        return Ok(true);
    }
    // PlaySound with SND_MEMORY must remain synchronous so the in-memory wave
    // stays valid. Serializing requests also stops a completion cue and a
    // Settings preview from replacing one another on Windows' shared player.
    static PLAYBACK_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    let _playback = PLAYBACK_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    // SND_SYNC is zero and keeps the in-memory WAV alive until playback ends.
    let played = unsafe {
        PlaySoundA(
            wave.as_ptr(),
            std::ptr::null_mut(),
            SND_MEMORY | SND_NODEFAULT,
        )
    };
    if played == 0 {
        Err("Windows could not play the notification sound.".to_string())
    } else {
        Ok(true)
    }
}

#[cfg(not(target_os = "windows"))]
fn play_wave(_wave: &[u8]) -> Result<bool, String> {
    Ok(false)
}

pub fn play(sound: &str) -> Result<bool, String> {
    play_wave(&render_wave(sound)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_named_sound_renders_a_short_pcm_wave() {
        for sound in ["clear", "gentle", "double", "wood"] {
            let wave = render_wave(sound).unwrap();
            assert_eq!(&wave[0..4], b"RIFF");
            assert_eq!(&wave[8..12], b"WAVE");
            assert_eq!(&wave[36..40], b"data");
            assert!(wave.len() > 44);
            assert!(wave.len() < 44 + SAMPLE_RATE as usize * 2);
            assert!(wave[44..].iter().any(|byte| *byte != 0));
        }
    }

    #[test]
    fn off_is_silent_and_unknown_names_are_rejected() {
        assert!(render_wave("off").unwrap().is_empty());
        assert!(render_wave("surprise").is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "plays a short cue through the real Windows output device"]
    fn windows_backend_plays_the_clear_cue() {
        assert_eq!(play("clear"), Ok(true));
    }
}
