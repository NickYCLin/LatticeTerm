use image::{imageops::FilterType, DynamicImage};
use lattice_remote::{
    frame_messages, generate_pairing_code, normalize_pairing_code, FrameFormat, RemoteHello,
    RemoteMessage, SecureConnection, DEFAULT_PORT, PROTOCOL_VERSION,
};
use std::env;
use std::io::Cursor;
use std::net::SocketAddr;
use std::time::{Duration, Instant};
use tokio::net::TcpListener;
use tokio::time::{sleep, timeout};
use xcap::Monitor;

const DEFAULT_FPS: u32 = 5;
const MAX_FPS: u32 = 10;
const MAX_WIDTH: u32 = 1280;
const MAX_HEIGHT: u32 = 720;
const MAX_PAIRING_FAILURES: u32 = 5;
const PAIRING_LIFETIME: Duration = Duration::from_secs(5 * 60);

struct Options {
    bind: SocketAddr,
    pairing_code: String,
    fps: u32,
}

fn help() -> &'static str {
    "Lattice Remote view-only agent\n\n\
Usage: lattice-agent [--bind ADDRESS:PORT] [--pair-code 1234-5678] [--fps 1-10]\n\n\
The safe default listens on 127.0.0.1 only. To receive a LAN connection, pass\n\
the machine's LAN address explicitly, for example --bind 192.168.1.20:44900.\n\
The agent accepts one successfully paired connection, streams the primary\n\
display over an encrypted channel, then exits. It never accepts input.\n"
}

fn parse_options() -> Result<Options, String> {
    let mut bind = format!("127.0.0.1:{DEFAULT_PORT}")
        .parse()
        .expect("default address is valid");
    let mut pairing_code = None;
    let mut fps = DEFAULT_FPS;
    let mut arguments = env::args().skip(1);

    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--bind" => {
                bind = arguments
                    .next()
                    .ok_or_else(|| "--bind needs ADDRESS:PORT".to_string())?
                    .parse()
                    .map_err(|_| "--bind must be a valid IP_ADDRESS:PORT".to_string())?;
            }
            "--pair-code" => {
                pairing_code = Some(
                    normalize_pairing_code(
                        &arguments
                            .next()
                            .ok_or_else(|| "--pair-code needs eight digits".to_string())?,
                    )
                    .map_err(|error| error.to_string())?,
                );
            }
            "--fps" => {
                fps = arguments
                    .next()
                    .ok_or_else(|| "--fps needs a number".to_string())?
                    .parse()
                    .map_err(|_| "--fps must be a number".to_string())?;
                if !(1..=MAX_FPS).contains(&fps) {
                    return Err(format!("--fps must be between 1 and {MAX_FPS}"));
                }
            }
            "--help" | "-h" => {
                print!("{}", help());
                std::process::exit(0);
            }
            unknown => return Err(format!("unknown option: {unknown}")),
        }
    }

    Ok(Options {
        bind,
        pairing_code: pairing_code
            .map(Ok)
            .unwrap_or_else(generate_pairing_code)
            .map_err(|error| error.to_string())?,
        fps,
    })
}

fn target_size(width: u32, height: u32) -> (u32, u32) {
    if width <= MAX_WIDTH && height <= MAX_HEIGHT {
        return (width, height);
    }
    let scale = (MAX_WIDTH as f64 / width as f64).min(MAX_HEIGHT as f64 / height as f64);
    (
        (width as f64 * scale).round().max(1.0) as u32,
        (height as f64 * scale).round().max(1.0) as u32,
    )
}

fn capture_jpeg(monitor: &Monitor) -> Result<(u32, u32, Vec<u8>), String> {
    let captured = monitor.capture_image().map_err(|error| error.to_string())?;
    let (width, height) = target_size(captured.width(), captured.height());
    let image = if captured.width() == width && captured.height() == height {
        captured
    } else {
        image::imageops::resize(&captured, width, height, FilterType::Triangle)
    };

    let mut output = Cursor::new(Vec::new());
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, 68);
    encoder
        .encode_image(&DynamicImage::ImageRgba8(image))
        .map_err(|error| error.to_string())?;
    Ok((width, height, output.into_inner()))
}

fn agent_name() -> String {
    env::var("COMPUTERNAME")
        .or_else(|_| env::var("HOSTNAME"))
        .ok()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "Lattice Agent".to_string())
}

async fn serve(mut connection: SecureConnection, fps: u32) -> Result<(), String> {
    let monitors = Monitor::all().map_err(|error| error.to_string())?;
    let monitor = monitors
        .into_iter()
        .find(|monitor| monitor.is_primary().unwrap_or(false))
        .ok_or_else(|| "no primary display is available".to_string())?;
    let (mut width, mut height, mut jpeg) = capture_jpeg(&monitor)?;

    connection
        .send(&RemoteMessage::Hello(RemoteHello {
            protocol_version: PROTOCOL_VERSION,
            agent_name: agent_name(),
            width,
            height,
            view_only: true,
        }))
        .await
        .map_err(|error| error.to_string())?;

    let interval = Duration::from_millis(1000 / fps as u64);
    let mut frame_id = 0u64;
    loop {
        let started = Instant::now();
        frame_id = frame_id.wrapping_add(1);
        for message in frame_messages(frame_id, width, height, FrameFormat::Jpeg, &jpeg)
            .map_err(|error| error.to_string())?
        {
            connection
                .send(&message)
                .await
                .map_err(|error| error.to_string())?;
        }

        if started.elapsed() < interval {
            sleep(interval - started.elapsed()).await;
        }
        (width, height, jpeg) = capture_jpeg(&monitor)?;
    }
}

#[tokio::main]
async fn main() {
    let options = match parse_options() {
        Ok(options) => options,
        Err(error) => {
            eprintln!("Error: {error}\n\n{}", help());
            std::process::exit(2);
        }
    };

    let listener = match TcpListener::bind(options.bind).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("Unable to listen on {}: {error}", options.bind);
            std::process::exit(1);
        }
    };

    println!("Lattice Remote is ready (view-only)");
    println!("Address: {}", options.bind);
    println!(
        "Pairing code: {}-{}",
        &options.pairing_code[..4],
        &options.pairing_code[4..]
    );
    println!("The code is valid for one successful connection and is not saved.");

    let expires_at = Instant::now() + PAIRING_LIFETIME;
    let mut failed_pairings = 0_u32;

    loop {
        let remaining = expires_at.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            eprintln!("Pairing code expired after five minutes.");
            break;
        }
        let (stream, peer) = match timeout(remaining, listener.accept()).await {
            Ok(Ok(connection)) => connection,
            Ok(Err(error)) => {
                eprintln!("Could not accept connection: {error}");
                continue;
            }
            Err(_) => {
                eprintln!("Pairing code expired after five minutes.");
                break;
            }
        };
        eprintln!("Pairing request from {peer}");
        let secure = match timeout(
            Duration::from_secs(10),
            SecureConnection::accept(stream, &options.pairing_code),
        )
        .await
        {
            Ok(Ok(connection)) => connection,
            Ok(Err(_)) => {
                failed_pairings += 1;
                eprintln!("Pairing rejected.");
                if failed_pairings >= MAX_PAIRING_FAILURES {
                    eprintln!("Too many failed pairing attempts; the Agent is stopping.");
                    break;
                }
                sleep(Duration::from_secs(u64::from(failed_pairings))).await;
                continue;
            }
            Err(_) => {
                failed_pairings += 1;
                eprintln!("Pairing timed out.");
                if failed_pairings >= MAX_PAIRING_FAILURES {
                    eprintln!("Too many failed pairing attempts; the Agent is stopping.");
                    break;
                }
                continue;
            }
        };

        println!("Paired with {peer}. Starting encrypted view-only stream.");
        if let Err(error) = serve(secure, options.fps).await {
            eprintln!("Session ended: {error}");
        }
        break;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downscales_to_the_v1_stream_boundary() {
        assert_eq!(target_size(1920, 1080), (1280, 720));
        assert_eq!(target_size(1280, 1024), (900, 720));
        assert_eq!(target_size(800, 600), (800, 600));
    }
}
