//! Isolated native VNC engine for LatticeTerm.
//!
//! Speaks the same line-oriented JSON protocol as the RDP engine: commands in
//! on stdin, events out on stdout, one JSON object per line. The password is
//! read once from the connect command and never echoed into any event.
//!
//! The engine keeps the whole framebuffer, applies the server's rectangle
//! updates to it, and ships throttled JPEG frames of the composited screen —
//! the WebView never sees VNC wire formats.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use image::codecs::jpeg::JpegEncoder;
use image::ExtendedColorType;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt as _, AsyncWriteExt as _, BufReader, Lines, Stdin, Stdout};
use tokio::net::TcpStream;
use vnc::{ClientKeyEvent, ClientMouseEvent, PixelFormat, VncConnector, VncEvent, X11Event};

/// How often, at most, a fresh composited frame goes out.
const FRAME_INTERVAL: Duration = Duration::from_millis(66);
/// VNC pointer button bits, per RFC 6143 §7.5.5.
const BUTTON_LEFT: u8 = 1 << 0;
const BUTTON_MIDDLE: u8 = 1 << 1;
const BUTTON_RIGHT: u8 = 1 << 2;
const WHEEL_UP: u8 = 1 << 3;
const WHEEL_DOWN: u8 = 1 << 4;
const WHEEL_LEFT: u8 = 1 << 5;
const WHEEL_RIGHT: u8 = 1 << 6;

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Command {
    Connect {
        hostname: String,
        port: u16,
        password: String,
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
        keysym: u32,
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
    Frame {
        frame_id: u64,
        width: u16,
        height: u16,
        mime_type: &'static str,
        base64: String,
    },
    AuthFailed,
    Failed {
        stage: &'static str,
        detail: String,
    },
    Closed {
        reason: String,
    },
}

/// The composited screen, always RGBA in server-resolution.
struct Framebuffer {
    width: u16,
    height: u16,
    pixels: Vec<u8>,
    dirty: bool,
}

impl Framebuffer {
    fn new() -> Self {
        Self {
            width: 0,
            height: 0,
            pixels: Vec::new(),
            dirty: false,
        }
    }

    fn resize(&mut self, width: u16, height: u16) {
        self.width = width;
        self.height = height;
        self.pixels = vec![0u8; usize::from(width) * usize::from(height) * 4];
        self.dirty = true;
    }

    /// Blits one server rectangle into the screen. Rectangles that fall
    /// outside the current resolution are clipped rather than trusted.
    fn blit(&mut self, rect: vnc::Rect, data: &[u8]) {
        let screen_width = usize::from(self.width);
        let rect_width = usize::from(rect.width);
        let bytes_per_row = rect_width * 4;
        for row in 0..usize::from(rect.height) {
            let source_start = row * bytes_per_row;
            let Some(source) = data.get(source_start..source_start + bytes_per_row) else {
                break;
            };
            let target_y = usize::from(rect.y) + row;
            if target_y >= usize::from(self.height) {
                break;
            }
            let target_start = (target_y * screen_width + usize::from(rect.x)) * 4;
            let Some(target) = self
                .pixels
                .get_mut(target_start..target_start + bytes_per_row)
            else {
                break;
            };
            target.copy_from_slice(source);
        }
        self.dirty = true;
    }

    /// CopyRect: moves one on-screen rectangle to another position.
    fn copy_rect(&mut self, dst: vnc::Rect, src_x: u16, src_y: u16) {
        let screen_width = usize::from(self.width);
        let bytes_per_row = usize::from(dst.width) * 4;
        let mut rows = Vec::with_capacity(usize::from(dst.height));
        for row in 0..usize::from(dst.height) {
            let from = ((usize::from(src_y) + row) * screen_width + usize::from(src_x)) * 4;
            match self.pixels.get(from..from + bytes_per_row) {
                Some(slice) => rows.push(slice.to_vec()),
                None => return,
            }
        }
        for (row, data) in rows.into_iter().enumerate() {
            let to = ((usize::from(dst.y) + row) * screen_width + usize::from(dst.x)) * 4;
            if let Some(target) = self.pixels.get_mut(to..to + bytes_per_row) {
                target.copy_from_slice(&data);
            }
        }
        self.dirty = true;
    }

    fn encode_jpeg(&self) -> Result<Vec<u8>, String> {
        // JPEG carries no alpha; strip the channel rather than ask the
        // encoder to guess.
        let mut rgb = Vec::with_capacity(self.pixels.len() / 4 * 3);
        for pixel in self.pixels.chunks_exact(4) {
            rgb.extend_from_slice(&pixel[..3]);
        }
        let mut jpeg = Vec::new();
        JpegEncoder::new_with_quality(&mut jpeg, 78)
            .encode(
                &rgb,
                u32::from(self.width),
                u32::from(self.height),
                ExtendedColorType::Rgb8,
            )
            .map_err(|error| error.to_string())?;
        Ok(jpeg)
    }
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

/// Tracks the pointer so button changes always carry the current position.
struct Pointer {
    x: u16,
    y: u16,
    buttons: u8,
}

impl Pointer {
    fn new() -> Self {
        Self {
            x: 0,
            y: 0,
            buttons: 0,
        }
    }

    fn event(&self) -> X11Event {
        X11Event::PointerEvent(ClientMouseEvent {
            position_x: self.x,
            position_y: self.y,
            bottons: self.buttons,
        })
    }
}

fn button_bit(button: u8) -> Option<u8> {
    match button {
        0 => Some(BUTTON_LEFT),
        1 => Some(BUTTON_MIDDLE),
        2 => Some(BUTTON_RIGHT),
        _ => None,
    }
}

/// Turns one interface command into the X11 events the server expects.
fn input_events(pointer: &mut Pointer, command: &Command) -> Vec<X11Event> {
    match command {
        Command::MouseMove { x, y } => {
            pointer.x = *x;
            pointer.y = *y;
            vec![pointer.event()]
        }
        Command::MouseButton { button, pressed } => {
            let Some(bit) = button_bit(*button) else {
                return Vec::new();
            };
            if *pressed {
                pointer.buttons |= bit;
            } else {
                pointer.buttons &= !bit;
            }
            vec![pointer.event()]
        }
        Command::Wheel { horizontal, units } => {
            // Each unit is a press-release pulse of the matching wheel bit.
            let bit = match (horizontal, units.is_negative()) {
                (false, true) => WHEEL_UP,
                (false, false) => WHEEL_DOWN,
                (true, true) => WHEEL_LEFT,
                (true, false) => WHEEL_RIGHT,
            };
            let pulses = units.unsigned_abs().min(8);
            let mut events = Vec::with_capacity(usize::from(pulses) * 2);
            for _ in 0..pulses {
                pointer.buttons |= bit;
                events.push(pointer.event());
                pointer.buttons &= !bit;
                events.push(pointer.event());
            }
            events
        }
        Command::Key { keysym, pressed } => vec![X11Event::KeyEvent(ClientKeyEvent {
            keycode: *keysym,
            down: *pressed,
        })],
        Command::ReleaseAll => {
            if pointer.buttons == 0 {
                return Vec::new();
            }
            pointer.buttons = 0;
            vec![pointer.event()]
        }
        Command::Connect { .. } | Command::Close => Vec::new(),
    }
}

async fn run_session(
    hostname: String,
    port: u16,
    password: String,
    lines: &mut Lines<BufReader<Stdin>>,
    stdout: &mut Stdout,
) -> Result<(), String> {
    let tcp = TcpStream::connect((hostname.as_str(), port))
        .await
        .map_err(|error| error.to_string())?;

    let client = match VncConnector::new(tcp)
        .set_auth_method(async move { Ok(password) })
        .add_encoding(vnc::VncEncoding::Zrle)
        .add_encoding(vnc::VncEncoding::CopyRect)
        .add_encoding(vnc::VncEncoding::Raw)
        .allow_shared(true)
        .set_pixel_format(PixelFormat::rgba())
        .build()
        .map_err(|error| error.to_string())?
        .try_start()
        .await
    {
        Ok(connection) => connection.finish().map_err(|error| error.to_string())?,
        Err(vnc::VncError::WrongPassword) => {
            emit(stdout, &Event::AuthFailed).await?;
            return Ok(());
        }
        Err(error) => {
            // Servers that refuse credentials in the SecurityResult message
            // surface here as a generic error whose text says so.
            let detail = error.to_string();
            if detail.to_ascii_lowercase().contains("auth") {
                emit(stdout, &Event::AuthFailed).await?;
            } else {
                emit(
                    stdout,
                    &Event::Failed {
                        stage: "connect",
                        detail,
                    },
                )
                .await?;
            }
            return Ok(());
        }
    };

    let mut framebuffer = Framebuffer::new();
    let mut pointer = Pointer::new();
    let mut announced = false;
    let mut frame_id = 0_u64;
    let mut ticker = tokio::time::interval(FRAME_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            command = read_command(lines) => {
                match command? {
                    Some(Command::Close) | None => {
                        let _ = client.close().await;
                        emit(stdout, &Event::Closed { reason: "disconnected".to_string() }).await?;
                        return Ok(());
                    }
                    Some(command) => {
                        for event in input_events(&mut pointer, &command) {
                            client
                                .input(event)
                                .await
                                .map_err(|error| error.to_string())?;
                        }
                    }
                }
            }
            event = client.poll_event() => {
                match event.map_err(|error| error.to_string())? {
                    Some(VncEvent::SetResolution(screen)) => {
                        framebuffer.resize(screen.width, screen.height);
                        if !announced {
                            announced = true;
                            emit(stdout, &Event::Connected {
                                width: screen.width,
                                height: screen.height,
                            }).await?;
                            // Ask for the first full screen straight away.
                            client
                                .input(X11Event::FullRefresh)
                                .await
                                .map_err(|error| error.to_string())?;
                        }
                    }
                    Some(VncEvent::RawImage(rect, data)) => framebuffer.blit(rect, &data),
                    Some(VncEvent::Copy(dst, src)) => framebuffer.copy_rect(dst, src.x, src.y),
                    Some(VncEvent::Error(detail)) => {
                        emit(stdout, &Event::Closed { reason: detail }).await?;
                        return Ok(());
                    }
                    // Bell, clipboard text, cursor shapes: nothing to composite.
                    Some(_) => {}
                    None => {}
                }
            }
            _ = ticker.tick() => {
                if framebuffer.dirty && framebuffer.width > 0 {
                    framebuffer.dirty = false;
                    frame_id = frame_id.wrapping_add(1);
                    let jpeg = framebuffer.encode_jpeg()?;
                    emit(stdout, &Event::Frame {
                        frame_id,
                        width: framebuffer.width,
                        height: framebuffer.height,
                        mime_type: "image/jpeg",
                        base64: BASE64.encode(jpeg),
                    }).await?;
                }
                if announced {
                    // Keep the update loop fed; the server answers when
                    // something changed.
                    client
                        .input(X11Event::Refresh)
                        .await
                        .map_err(|error| error.to_string())?;
                }
            }
        }
    }
}

#[tokio::main]
async fn main() {
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    let mut stdout = tokio::io::stdout();

    let (hostname, port, password) = match read_command(&mut lines).await {
        Ok(Some(Command::Connect {
            hostname,
            port,
            password,
        })) => (hostname, port, password),
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

    if let Err(error) = run_session(hostname, port, password, &mut lines, &mut stdout).await {
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

    fn rect(x: u16, y: u16, width: u16, height: u16) -> vnc::Rect {
        vnc::Rect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn rectangles_land_where_the_server_says() {
        let mut framebuffer = Framebuffer::new();
        framebuffer.resize(4, 4);

        // A 2x2 red square at (1, 1).
        let red = [255, 0, 0, 255].repeat(4);
        framebuffer.blit(rect(1, 1, 2, 2), &red);

        let pixel = |x: usize, y: usize| {
            let start = (y * 4 + x) * 4;
            &framebuffer.pixels[start..start + 4]
        };
        assert_eq!(pixel(1, 1), &[255, 0, 0, 255]);
        assert_eq!(pixel(2, 2), &[255, 0, 0, 255]);
        assert_eq!(pixel(0, 0), &[0, 0, 0, 0]);
        assert_eq!(pixel(3, 3), &[0, 0, 0, 0]);
    }

    #[test]
    fn oversized_rectangles_are_clipped_not_trusted() {
        let mut framebuffer = Framebuffer::new();
        framebuffer.resize(2, 2);

        // Claims to be 4x4 at the origin of a 2x2 screen.
        let data = [9u8; 4 * 4 * 4];
        framebuffer.blit(rect(0, 0, 4, 4), &data);
        // No panic and the buffer stays its own size.
        assert_eq!(framebuffer.pixels.len(), 2 * 2 * 4);
    }

    #[test]
    fn copyrect_moves_pixels_within_the_screen() {
        let mut framebuffer = Framebuffer::new();
        framebuffer.resize(4, 1);
        framebuffer.blit(rect(0, 0, 1, 1), &[1, 2, 3, 4]);

        framebuffer.copy_rect(rect(2, 0, 1, 1), 0, 0);

        let start = 2 * 4;
        assert_eq!(&framebuffer.pixels[start..start + 4], &[1, 2, 3, 4]);
    }

    #[test]
    fn wheel_units_become_press_release_pulses() {
        let mut pointer = Pointer::new();
        let events = input_events(
            &mut pointer,
            &Command::Wheel {
                horizontal: false,
                units: -2,
            },
        );
        // Two pulses, each a press and a release.
        assert_eq!(events.len(), 4);
        assert_eq!(pointer.buttons, 0, "no wheel bit stays latched");
    }

    #[test]
    fn button_state_accumulates_and_release_all_clears_it() {
        let mut pointer = Pointer::new();
        input_events(
            &mut pointer,
            &Command::MouseButton {
                button: 0,
                pressed: true,
            },
        );
        input_events(
            &mut pointer,
            &Command::MouseButton {
                button: 2,
                pressed: true,
            },
        );
        assert_eq!(pointer.buttons, BUTTON_LEFT | BUTTON_RIGHT);

        let release = input_events(&mut pointer, &Command::ReleaseAll);
        assert_eq!(release.len(), 1);
        assert_eq!(pointer.buttons, 0);
    }

    #[test]
    fn commands_parse_from_the_sidecar_protocol() {
        let connect: Command = serde_json::from_str(
            r#"{"kind":"connect","hostname":"vnc.test","port":5900,"password":"secret"}"#,
        )
        .unwrap();
        assert!(matches!(connect, Command::Connect { port: 5900, .. }));

        let key: Command =
            serde_json::from_str(r#"{"kind":"key","keysym":65293,"pressed":true}"#).unwrap();
        assert!(matches!(
            key,
            Command::Key {
                keysym: 65293,
                pressed: true
            }
        ));
    }
}
