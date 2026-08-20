//! One-session IronRDP engine controlled by LatticeTerm over NDJSON.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use image::codecs::jpeg::JpegEncoder;
use image::{ExtendedColorType, ImageEncoder as _};
use ironrdp::client::config::{ConfigBuilder, Destination};
use ironrdp::client::rdp::{
    AutoReconnectDecision, RdpClient, RdpInputEvent, RdpInputSender, RdpOutputEvent,
};
use ironrdp::input::{Database, MouseButton, MousePosition, Operation, Scancode, WheelRotations};
use ironrdp::pdu::rdp::capability_sets::MajorPlatformType;
use ironrdp_tls::{CertificateValidation, CertificateValidationCallback};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt as _, AsyncWriteExt as _, BufReader, Lines, Stdin, Stdout};
use tokio::sync::mpsc;

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Command {
    Connect {
        hostname: String,
        port: u16,
        username: String,
        password: String,
        domain: Option<String>,
        width: u16,
        height: u16,
        trusted_certificate_sha256: Option<String>,
    },
    MouseMove {
        x: u16,
        y: u16,
    },
    MouseButton {
        button: u8,
        pressed: bool,
    },
    Wheel {
        horizontal: bool,
        units: i16,
    },
    Key {
        scancode: u16,
        pressed: bool,
    },
    Unicode {
        character: char,
        pressed: bool,
    },
    ReleaseAll,
    Close,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Event {
    Connected {
        width: u16,
        height: u16,
    },
    CertificateUnknown {
        fingerprint_sha256: String,
        detail: String,
    },
    Frame {
        frame_id: u64,
        width: u16,
        height: u16,
        mime_type: &'static str,
        base64: String,
    },
    Failed {
        stage: &'static str,
        detail: String,
    },
    Closed {
        reason: String,
    },
}

struct ConnectSettings {
    hostname: String,
    port: u16,
    username: String,
    password: String,
    domain: Option<String>,
    width: u16,
    height: u16,
    trusted_certificate_sha256: Option<String>,
}

fn normalize_fingerprint(value: &str) -> Option<String> {
    let normalized: String = value
        .chars()
        .filter(|character| character.is_ascii_hexdigit())
        .map(|character| character.to_ascii_uppercase())
        .collect();
    (normalized.len() == 64).then_some(normalized)
}

fn fingerprint(der: &[u8]) -> String {
    Sha256::digest(der)
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

fn encode_frame(buffer: &[u32], width: u16, height: u16) -> Result<Vec<u8>, String> {
    let expected = usize::from(width) * usize::from(height);
    if buffer.len() != expected {
        return Err("IronRDP returned an invalid framebuffer size.".to_string());
    }

    let mut rgba = Vec::with_capacity(expected * 4);
    for pixel in buffer {
        rgba.extend_from_slice(&pixel.to_le_bytes());
    }
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, 78)
        .write_image(
            &rgba,
            u32::from(width),
            u32::from(height),
            ExtendedColorType::Rgba8,
        )
        .map_err(|error| error.to_string())?;
    Ok(jpeg)
}

async fn emit(stdout: &mut Stdout, event: &Event) -> Result<(), String> {
    let mut line = serde_json::to_vec(event).map_err(|error| error.to_string())?;
    line.push(b'\n');
    stdout
        .write_all(&line)
        .await
        .map_err(|error| error.to_string())?;
    stdout.flush().await.map_err(|error| error.to_string())
}

async fn read_command(lines: &mut Lines<BufReader<Stdin>>) -> Result<Option<Command>, String> {
    let Some(line) = lines.next_line().await.map_err(|error| error.to_string())? else {
        return Ok(None);
    };
    serde_json::from_str(&line)
        .map(Some)
        .map_err(|error| error.to_string())
}

fn input_events(
    database: &mut Database,
    command: Command,
) -> Result<Option<RdpInputEvent>, String> {
    let operations = match command {
        Command::MouseMove { x, y } => vec![Operation::MouseMove(MousePosition { x, y })],
        Command::MouseButton { button, pressed } => {
            let button = MouseButton::from_web_button(button)
                .ok_or_else(|| "Unsupported mouse button.".to_string())?;
            vec![if pressed {
                Operation::MouseButtonPressed(button)
            } else {
                Operation::MouseButtonReleased(button)
            }]
        }
        Command::Wheel { horizontal, units } => vec![Operation::WheelRotations(WheelRotations {
            is_vertical: !horizontal,
            rotation_units: units,
        })],
        Command::Key { scancode, pressed } => {
            let key = Scancode::from_u16(scancode);
            vec![if pressed {
                Operation::KeyPressed(key)
            } else {
                Operation::KeyReleased(key)
            }]
        }
        Command::Unicode { character, pressed } => vec![if pressed {
            Operation::UnicodeKeyPressed(character)
        } else {
            Operation::UnicodeKeyReleased(character)
        }],
        Command::ReleaseAll => {
            let events = database.release_all();
            return Ok((!events.is_empty()).then_some(RdpInputEvent::FastPath(events)));
        }
        Command::Close | Command::Connect { .. } => return Ok(None),
    };
    let events = database.apply(operations);
    Ok((!events.is_empty()).then_some(RdpInputEvent::FastPath(events)))
}

async fn run_session(
    settings: ConnectSettings,
    lines: &mut Lines<BufReader<Stdin>>,
    stdout: &mut Stdout,
) -> Result<(), String> {
    let approved = settings
        .trusted_certificate_sha256
        .as_deref()
        .and_then(normalize_fingerprint);
    let observed_certificate = Arc::new(Mutex::new(None::<(String, String)>));
    let observed_for_callback = Arc::clone(&observed_certificate);
    let callback: CertificateValidationCallback = Arc::new(move |der, validation_error| {
        let formatted = fingerprint(der);
        let presented = normalize_fingerprint(&formatted).expect("generated SHA-256 fingerprint");
        if let Ok(mut observed) = observed_for_callback.lock() {
            *observed = Some((formatted, validation_error.to_string()));
        }
        approved.as_deref() == Some(presented.as_str())
    });

    let mut builder = ConfigBuilder::new()
        .with_destination(Destination::from_parts(settings.hostname, settings.port))
        .with_username(settings.username)
        .with_password(settings.password)
        .with_client_build(200)
        .with_client_dir("C:\\Windows\\System32\\mstscax.dll")
        .with_client_name("LatticeTerm")
        .with_platform(MajorPlatformType::UNSPECIFIED)
        .with_desktop_width(settings.width)
        .with_desktop_height(settings.height)
        .with_tls(false)
        .with_credssp(true)
        .with_server_pointer(true)
        .with_pointer_software_rendering(true)
        .with_certificate_validation(CertificateValidation::Strict)
        .with_certificate_validation_callback(callback);
    if let Some(domain) = settings.domain.filter(|value| !value.trim().is_empty()) {
        builder = builder.with_domain(domain);
    }
    let config = builder.build().map_err(|error| error.to_string())?;
    let (output_sender, mut output_receiver) = mpsc::channel::<RdpOutputEvent>(16);
    let client = RdpClient::new(config, output_sender).with_auto_reconnect(2);
    let input_sender: RdpInputSender = client.input_sender();
    tokio::task::spawn_local(client.run());

    let mut database = Database::new();
    let mut frame_id = 0_u64;
    loop {
        tokio::select! {
            command = read_command(lines) => {
                match command? {
                    Some(Command::Close) | None => {
                        input_sender.request_graceful_close();
                        return Ok(());
                    }
                    Some(command) => {
                        if let Some(event) = input_events(&mut database, command)? {
                            input_sender.try_send(event).map_err(|_| "RDP input queue is full.".to_string())?;
                        }
                    }
                }
            }
            output = output_receiver.recv() => {
                match output {
                    Some(RdpOutputEvent::Connected) => {
                        emit(stdout, &Event::Connected { width: settings.width, height: settings.height }).await?;
                    }
                    Some(RdpOutputEvent::Image { buffer, width, height }) => {
                        frame_id = frame_id.wrapping_add(1);
                        let width = width.get();
                        let height = height.get();
                        let bytes = encode_frame(&buffer, width, height)?;
                        emit(stdout, &Event::Frame {
                            frame_id,
                            width,
                            height,
                            mime_type: "image/jpeg",
                            base64: BASE64.encode(bytes),
                        }).await?;
                    }
                    Some(RdpOutputEvent::ConnectionFailure(error)) => {
                        if let Some((fingerprint_sha256, detail)) = observed_certificate.lock().ok().and_then(|value| value.clone()) {
                            emit(stdout, &Event::CertificateUnknown { fingerprint_sha256, detail }).await?;
                        } else {
                            emit(stdout, &Event::Failed { stage: "connect", detail: error.report().to_string() }).await?;
                        }
                        return Ok(());
                    }
                    Some(RdpOutputEvent::Terminated(result)) => {
                        let reason = result.map(|reason| reason.to_string()).unwrap_or_else(|error| error.to_string());
                        emit(stdout, &Event::Closed { reason }).await?;
                        return Ok(());
                    }
                    Some(RdpOutputEvent::AutoReconnecting { response, .. }) => {
                        let _ = response.send(AutoReconnectDecision::Continue);
                    }
                    Some(_) => {}
                    None => {
                        emit(stdout, &Event::Closed { reason: "The RDP engine stopped without a final status.".to_string() }).await?;
                        return Ok(());
                    }
                }
            }
        }
    }
}

#[tokio::main]
async fn main() {
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    let mut stdout = tokio::io::stdout();
    let settings = match read_command(&mut lines).await {
        Ok(Some(Command::Connect {
            hostname,
            port,
            username,
            password,
            domain,
            width,
            height,
            trusted_certificate_sha256,
        })) => ConnectSettings {
            hostname,
            port,
            username,
            password,
            domain,
            width: width.clamp(640, 1920),
            height: height.clamp(480, 1200),
            trusted_certificate_sha256,
        },
        Ok(_) => {
            let _ = emit(
                &mut stdout,
                &Event::Failed {
                    stage: "protocol",
                    detail: "The first command must start a connection.".to_string(),
                },
            )
            .await;
            return;
        }
        Err(error) => {
            let _ = emit(
                &mut stdout,
                &Event::Failed {
                    stage: "protocol",
                    detail: error,
                },
            )
            .await;
            return;
        }
    };

    let local = tokio::task::LocalSet::new();
    if let Err(error) = local
        .run_until(run_session(settings, &mut lines, &mut stdout))
        .await
    {
        let _ = emit(
            &mut stdout,
            &Event::Failed {
                stage: "engine",
                detail: error,
            },
        )
        .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_formatted_sha256_fingerprint() {
        let formatted = fingerprint(b"certificate");
        let normalized = normalize_fingerprint(&formatted).expect("valid fingerprint");
        assert_eq!(normalized.len(), 64);
        assert!(!normalized.contains(':'));
    }

    #[test]
    fn rejects_short_certificate_fingerprint() {
        assert!(normalize_fingerprint("AA:BB").is_none());
    }
}
