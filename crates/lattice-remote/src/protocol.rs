use std::fmt;

pub const PROTOCOL_VERSION: u16 = 1;
pub const DEFAULT_PORT: u16 = 44_900;
pub const FRAME_CHUNK_SIZE: usize = 48 * 1024;
pub const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_AGENT_NAME_BYTES: usize = 256;
pub const MAX_FRAME_DIMENSION: u32 = 16_384;
pub const MAX_FRAME_PIXELS: u64 = 32 * 1024 * 1024;
pub const MAX_CLOSE_REASON_BYTES: usize = 1024;

const MESSAGE_HELLO: u8 = 1;
const MESSAGE_FRAME_START: u8 = 2;
const MESSAGE_FRAME_CHUNK: u8 = 3;
const MESSAGE_KEEP_ALIVE: u8 = 4;
const MESSAGE_CLOSE: u8 = 5;
const MESSAGE_INPUT: u8 = 6;

const INPUT_MOUSE_MOVE: u8 = 1;
const INPUT_MOUSE_BUTTON: u8 = 2;
const INPUT_WHEEL: u8 = 3;
const INPUT_KEY: u8 = 4;
const INPUT_RELEASE_ALL: u8 = 5;

/// One wheel message may scroll at most this many notches in either direction.
pub const MAX_WHEEL_UNITS: i8 = 8;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteHello {
    pub protocol_version: u16,
    pub agent_name: String,
    pub width: u32,
    pub height: u32,
    pub view_only: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameFormat {
    Jpeg,
}

impl FrameFormat {
    fn encode(self) -> u8 {
        match self {
            Self::Jpeg => 1,
        }
    }

    fn decode(value: u8) -> Result<Self, ProtocolError> {
        match value {
            1 => Ok(Self::Jpeg),
            _ => Err(ProtocolError::InvalidMessage("unknown frame format")),
        }
    }

    pub fn mime_type(self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrameDescriptor {
    pub frame_id: u64,
    pub width: u32,
    pub height: u32,
    pub encoded_len: u32,
    pub chunk_count: u16,
    pub format: FrameFormat,
}

/// A mouse button in the three-button model every target platform shares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PointerButton {
    Left,
    Middle,
    Right,
}

impl PointerButton {
    fn encode(self) -> u8 {
        match self {
            Self::Left => 0,
            Self::Middle => 1,
            Self::Right => 2,
        }
    }

    fn decode(value: u8) -> Result<Self, ProtocolError> {
        match value {
            0 => Ok(Self::Left),
            1 => Ok(Self::Middle),
            2 => Ok(Self::Right),
            _ => Err(ProtocolError::InvalidMessage("unknown pointer button")),
        }
    }
}

/// Viewer-to-agent input. Only valid after a Hello that advertised
/// `view_only: false`; a view-only agent drops these without acting on them.
///
/// Coordinates are in the agent's advertised stream space (the Hello
/// width/height); the agent maps them onto the real display. Keys use X11
/// keysyms, the same encoding the VNC pane already produces.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteInput {
    MouseMove { x: u16, y: u16 },
    MouseButton { button: PointerButton, pressed: bool },
    Wheel { horizontal: bool, units: i8 },
    Key { keysym: u32, pressed: bool },
    ReleaseAll,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemoteMessage {
    Hello(RemoteHello),
    FrameStart(FrameDescriptor),
    FrameChunk {
        frame_id: u64,
        chunk_index: u16,
        bytes: Vec<u8>,
    },
    KeepAlive,
    Close(String),
    Input(RemoteInput),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompleteFrame {
    pub frame_id: u64,
    pub width: u32,
    pub height: u32,
    pub format: FrameFormat,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolError {
    InvalidMessage(&'static str),
    InvalidText,
    InvalidHello,
    FrameTooLarge(usize),
    UnexpectedChunk,
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidMessage(reason) => write!(formatter, "invalid message: {reason}"),
            Self::InvalidText => write!(formatter, "message contains invalid UTF-8"),
            Self::InvalidHello => write!(formatter, "invalid hello payload"),
            Self::FrameTooLarge(size) => write!(formatter, "frame is too large ({size} bytes)"),
            Self::UnexpectedChunk => write!(formatter, "frame chunks arrived out of order"),
        }
    }
}

impl std::error::Error for ProtocolError {}

fn valid_frame_dimensions(width: u32, height: u32) -> bool {
    width > 0
        && height > 0
        && width <= MAX_FRAME_DIMENSION
        && height <= MAX_FRAME_DIMENSION
        && u64::from(width) * u64::from(height) <= MAX_FRAME_PIXELS
}

fn validate_hello(hello: &RemoteHello) -> Result<(), ProtocolError> {
    if hello.agent_name.is_empty()
        || hello.agent_name.len() > MAX_AGENT_NAME_BYTES
        || hello.agent_name.chars().any(char::is_control)
        || !valid_frame_dimensions(hello.width, hello.height)
    {
        return Err(ProtocolError::InvalidHello);
    }
    Ok(())
}

fn validate_frame_descriptor(frame: &FrameDescriptor) -> Result<(), ProtocolError> {
    let encoded_len = frame.encoded_len as usize;
    let expected_chunks = encoded_len.div_ceil(FRAME_CHUNK_SIZE);
    if !valid_frame_dimensions(frame.width, frame.height)
        || encoded_len == 0
        || encoded_len > MAX_FRAME_BYTES
        || frame.chunk_count as usize != expected_chunks
    {
        return Err(ProtocolError::InvalidMessage("invalid frame descriptor"));
    }
    Ok(())
}

fn validate_input(input: &RemoteInput) -> Result<(), ProtocolError> {
    match input {
        RemoteInput::Wheel { units, .. } => {
            if *units == 0 || units.unsigned_abs() > MAX_WHEEL_UNITS.unsigned_abs() {
                return Err(ProtocolError::InvalidMessage("wheel units out of range"));
            }
        }
        RemoteInput::MouseMove { .. }
        | RemoteInput::MouseButton { .. }
        | RemoteInput::Key { .. }
        | RemoteInput::ReleaseAll => {}
    }
    Ok(())
}

impl RemoteMessage {
    pub fn encode(&self) -> Result<Vec<u8>, ProtocolError> {
        match self {
            Self::Hello(hello) => {
                validate_hello(hello)?;
                let name = hello.agent_name.as_bytes();
                let mut output = Vec::with_capacity(14 + name.len());
                output.push(MESSAGE_HELLO);
                output.extend_from_slice(&hello.protocol_version.to_be_bytes());
                output.extend_from_slice(&hello.width.to_be_bytes());
                output.extend_from_slice(&hello.height.to_be_bytes());
                output.push(u8::from(hello.view_only));
                output.extend_from_slice(&(name.len() as u16).to_be_bytes());
                output.extend_from_slice(name);
                Ok(output)
            }
            Self::FrameStart(frame) => {
                validate_frame_descriptor(frame)?;
                let mut output = Vec::with_capacity(24);
                output.push(MESSAGE_FRAME_START);
                output.extend_from_slice(&frame.frame_id.to_be_bytes());
                output.extend_from_slice(&frame.width.to_be_bytes());
                output.extend_from_slice(&frame.height.to_be_bytes());
                output.extend_from_slice(&frame.encoded_len.to_be_bytes());
                output.extend_from_slice(&frame.chunk_count.to_be_bytes());
                output.push(frame.format.encode());
                Ok(output)
            }
            Self::FrameChunk {
                frame_id,
                chunk_index,
                bytes,
            } => {
                if bytes.len() > FRAME_CHUNK_SIZE {
                    return Err(ProtocolError::InvalidMessage("frame chunk is too large"));
                }
                let mut output = Vec::with_capacity(11 + bytes.len());
                output.push(MESSAGE_FRAME_CHUNK);
                output.extend_from_slice(&frame_id.to_be_bytes());
                output.extend_from_slice(&chunk_index.to_be_bytes());
                output.extend_from_slice(bytes);
                Ok(output)
            }
            Self::KeepAlive => Ok(vec![MESSAGE_KEEP_ALIVE]),
            Self::Input(input) => {
                validate_input(input)?;
                let mut output = Vec::with_capacity(8);
                output.push(MESSAGE_INPUT);
                match input {
                    RemoteInput::MouseMove { x, y } => {
                        output.push(INPUT_MOUSE_MOVE);
                        output.extend_from_slice(&x.to_be_bytes());
                        output.extend_from_slice(&y.to_be_bytes());
                    }
                    RemoteInput::MouseButton { button, pressed } => {
                        output.push(INPUT_MOUSE_BUTTON);
                        output.push(button.encode());
                        output.push(u8::from(*pressed));
                    }
                    RemoteInput::Wheel { horizontal, units } => {
                        output.push(INPUT_WHEEL);
                        output.push(u8::from(*horizontal));
                        output.push(units.to_be_bytes()[0]);
                    }
                    RemoteInput::Key { keysym, pressed } => {
                        output.push(INPUT_KEY);
                        output.extend_from_slice(&keysym.to_be_bytes());
                        output.push(u8::from(*pressed));
                    }
                    RemoteInput::ReleaseAll => output.push(INPUT_RELEASE_ALL),
                }
                Ok(output)
            }
            Self::Close(reason) => {
                let bytes = reason.as_bytes();
                if bytes.len() > MAX_CLOSE_REASON_BYTES {
                    return Err(ProtocolError::InvalidMessage("close reason is too long"));
                }
                let mut output = Vec::with_capacity(1 + bytes.len());
                output.push(MESSAGE_CLOSE);
                output.extend_from_slice(bytes);
                Ok(output)
            }
        }
    }

    pub fn decode(input: &[u8]) -> Result<Self, ProtocolError> {
        let kind = *input
            .first()
            .ok_or(ProtocolError::InvalidMessage("empty message"))?;
        let body = &input[1..];

        match kind {
            MESSAGE_HELLO => {
                if body.len() < 13 {
                    return Err(ProtocolError::InvalidHello);
                }
                let protocol_version = read_u16(body, 0)?;
                let width = read_u32(body, 2)?;
                let height = read_u32(body, 6)?;
                let view_only = match body[10] {
                    0 => false,
                    1 => true,
                    _ => return Err(ProtocolError::InvalidHello),
                };
                let name_len = read_u16(body, 11)? as usize;
                if name_len == 0 || body.len() != 13 + name_len {
                    return Err(ProtocolError::InvalidHello);
                }
                let agent_name = std::str::from_utf8(&body[13..])
                    .map_err(|_| ProtocolError::InvalidText)?
                    .to_string();
                let hello = RemoteHello {
                    protocol_version,
                    agent_name,
                    width,
                    height,
                    view_only,
                };
                validate_hello(&hello)?;
                Ok(Self::Hello(hello))
            }
            MESSAGE_FRAME_START => {
                if body.len() != 23 {
                    return Err(ProtocolError::InvalidMessage("invalid frame start length"));
                }
                let descriptor = FrameDescriptor {
                    frame_id: read_u64(body, 0)?,
                    width: read_u32(body, 8)?,
                    height: read_u32(body, 12)?,
                    encoded_len: read_u32(body, 16)?,
                    chunk_count: read_u16(body, 20)?,
                    format: FrameFormat::decode(body[22])?,
                };
                validate_frame_descriptor(&descriptor)?;
                Ok(Self::FrameStart(descriptor))
            }
            MESSAGE_FRAME_CHUNK => {
                if body.len() < 10 {
                    return Err(ProtocolError::InvalidMessage("invalid frame chunk length"));
                }
                let bytes = body[10..].to_vec();
                if bytes.len() > FRAME_CHUNK_SIZE {
                    return Err(ProtocolError::InvalidMessage("frame chunk is too large"));
                }
                Ok(Self::FrameChunk {
                    frame_id: read_u64(body, 0)?,
                    chunk_index: read_u16(body, 8)?,
                    bytes,
                })
            }
            MESSAGE_KEEP_ALIVE if body.is_empty() => Ok(Self::KeepAlive),
            MESSAGE_INPUT => {
                let subkind = *body
                    .first()
                    .ok_or(ProtocolError::InvalidMessage("empty input message"))?;
                let detail = &body[1..];
                let input = match subkind {
                    INPUT_MOUSE_MOVE if detail.len() == 4 => RemoteInput::MouseMove {
                        x: read_u16(detail, 0)?,
                        y: read_u16(detail, 2)?,
                    },
                    INPUT_MOUSE_BUTTON if detail.len() == 2 => RemoteInput::MouseButton {
                        button: PointerButton::decode(detail[0])?,
                        pressed: decode_bool(detail[1])?,
                    },
                    INPUT_WHEEL if detail.len() == 2 => RemoteInput::Wheel {
                        horizontal: decode_bool(detail[0])?,
                        units: i8::from_be_bytes([detail[1]]),
                    },
                    INPUT_KEY if detail.len() == 5 => RemoteInput::Key {
                        keysym: read_u32(detail, 0)?,
                        pressed: decode_bool(detail[4])?,
                    },
                    INPUT_RELEASE_ALL if detail.is_empty() => RemoteInput::ReleaseAll,
                    _ => return Err(ProtocolError::InvalidMessage("invalid input message")),
                };
                validate_input(&input)?;
                Ok(Self::Input(input))
            }
            MESSAGE_CLOSE => {
                if body.len() > MAX_CLOSE_REASON_BYTES {
                    return Err(ProtocolError::InvalidMessage("close reason is too long"));
                }
                Ok(Self::Close(
                    std::str::from_utf8(body)
                        .map_err(|_| ProtocolError::InvalidText)?
                        .to_string(),
                ))
            }
            _ => Err(ProtocolError::InvalidMessage("unknown message type")),
        }
    }
}

fn decode_bool(value: u8) -> Result<bool, ProtocolError> {
    match value {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(ProtocolError::InvalidMessage("invalid boolean byte")),
    }
}

fn read_u16(input: &[u8], offset: usize) -> Result<u16, ProtocolError> {
    let bytes = input
        .get(offset..offset + 2)
        .ok_or(ProtocolError::InvalidMessage("truncated integer"))?;
    Ok(u16::from_be_bytes([bytes[0], bytes[1]]))
}

fn read_u32(input: &[u8], offset: usize) -> Result<u32, ProtocolError> {
    let bytes = input
        .get(offset..offset + 4)
        .ok_or(ProtocolError::InvalidMessage("truncated integer"))?;
    Ok(u32::from_be_bytes(
        bytes.try_into().expect("four-byte slice"),
    ))
}

fn read_u64(input: &[u8], offset: usize) -> Result<u64, ProtocolError> {
    let bytes = input
        .get(offset..offset + 8)
        .ok_or(ProtocolError::InvalidMessage("truncated integer"))?;
    Ok(u64::from_be_bytes(
        bytes.try_into().expect("eight-byte slice"),
    ))
}

pub fn frame_messages(
    frame_id: u64,
    width: u32,
    height: u32,
    format: FrameFormat,
    bytes: &[u8],
) -> Result<Vec<RemoteMessage>, ProtocolError> {
    if bytes.is_empty() {
        return Err(ProtocolError::InvalidMessage("empty frame"));
    }
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(ProtocolError::FrameTooLarge(bytes.len()));
    }
    let chunks = bytes.len().div_ceil(FRAME_CHUNK_SIZE);
    if chunks > u16::MAX as usize {
        return Err(ProtocolError::FrameTooLarge(bytes.len()));
    }

    let descriptor = FrameDescriptor {
        frame_id,
        width,
        height,
        encoded_len: bytes.len() as u32,
        chunk_count: chunks as u16,
        format,
    };
    validate_frame_descriptor(&descriptor)?;

    let mut messages = Vec::with_capacity(chunks + 1);
    messages.push(RemoteMessage::FrameStart(descriptor));
    for (index, chunk) in bytes.chunks(FRAME_CHUNK_SIZE).enumerate() {
        messages.push(RemoteMessage::FrameChunk {
            frame_id,
            chunk_index: index as u16,
            bytes: chunk.to_vec(),
        });
    }
    Ok(messages)
}

#[derive(Debug, Default)]
pub struct FrameAssembler {
    pending: Option<PendingFrame>,
}

#[derive(Debug)]
struct PendingFrame {
    descriptor: FrameDescriptor,
    next_chunk: u16,
    bytes: Vec<u8>,
}

impl FrameAssembler {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, message: RemoteMessage) -> Result<Option<CompleteFrame>, ProtocolError> {
        match message {
            RemoteMessage::FrameStart(descriptor) => {
                validate_frame_descriptor(&descriptor)?;
                let encoded_len = descriptor.encoded_len as usize;
                self.pending = Some(PendingFrame {
                    descriptor,
                    next_chunk: 0,
                    bytes: Vec::with_capacity(encoded_len),
                });
                Ok(None)
            }
            RemoteMessage::FrameChunk {
                frame_id,
                chunk_index,
                bytes,
            } => {
                let pending = self
                    .pending
                    .as_mut()
                    .ok_or(ProtocolError::UnexpectedChunk)?;
                if pending.descriptor.frame_id != frame_id || pending.next_chunk != chunk_index {
                    self.pending = None;
                    return Err(ProtocolError::UnexpectedChunk);
                }
                if pending.bytes.len() + bytes.len() > pending.descriptor.encoded_len as usize {
                    self.pending = None;
                    return Err(ProtocolError::UnexpectedChunk);
                }
                pending.bytes.extend_from_slice(&bytes);
                pending.next_chunk += 1;

                if pending.next_chunk == pending.descriptor.chunk_count {
                    let complete = self.pending.take().expect("pending frame exists");
                    if complete.bytes.len() != complete.descriptor.encoded_len as usize {
                        return Err(ProtocolError::UnexpectedChunk);
                    }
                    return Ok(Some(CompleteFrame {
                        frame_id: complete.descriptor.frame_id,
                        width: complete.descriptor.width,
                        height: complete.descriptor.height,
                        format: complete.descriptor.format,
                        bytes: complete.bytes,
                    }));
                }
                Ok(None)
            }
            _ => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hello_round_trips() {
        let message = RemoteMessage::Hello(RemoteHello {
            protocol_version: PROTOCOL_VERSION,
            agent_name: "Studio Mac".into(),
            width: 1280,
            height: 720,
            view_only: true,
        });
        assert_eq!(
            RemoteMessage::decode(&message.encode().unwrap()).unwrap(),
            message
        );
    }

    #[test]
    fn rejects_unsafe_hello_metadata_on_encode_and_decode() {
        let oversized_name = RemoteMessage::Hello(RemoteHello {
            protocol_version: PROTOCOL_VERSION,
            agent_name: "a".repeat(MAX_AGENT_NAME_BYTES + 1),
            width: 1280,
            height: 720,
            view_only: true,
        });
        assert_eq!(oversized_name.encode(), Err(ProtocolError::InvalidHello));

        let control_name = RemoteMessage::Hello(RemoteHello {
            protocol_version: PROTOCOL_VERSION,
            agent_name: "host\nname".into(),
            width: 1280,
            height: 720,
            view_only: true,
        });
        assert_eq!(control_name.encode(), Err(ProtocolError::InvalidHello));

        let mut oversized_dimensions = RemoteMessage::Hello(RemoteHello {
            protocol_version: PROTOCOL_VERSION,
            agent_name: "Studio Mac".into(),
            width: 1280,
            height: 720,
            view_only: true,
        })
        .encode()
        .unwrap();
        oversized_dimensions[3..7].copy_from_slice(&(MAX_FRAME_DIMENSION + 1).to_be_bytes());
        assert_eq!(
            RemoteMessage::decode(&oversized_dimensions),
            Err(ProtocolError::InvalidHello)
        );
    }

    #[test]
    fn rejects_unsafe_frame_dimensions_before_assembly() {
        let one_pixel = [0x5a];
        assert!(
            frame_messages(1, MAX_FRAME_DIMENSION + 1, 1, FrameFormat::Jpeg, &one_pixel,).is_err()
        );
        assert!(frame_messages(
            1,
            MAX_FRAME_DIMENSION,
            (MAX_FRAME_PIXELS / u64::from(MAX_FRAME_DIMENSION)) as u32 + 1,
            FrameFormat::Jpeg,
            &one_pixel,
        )
        .is_err());
        assert!(frame_messages(1, 8192, 4096, FrameFormat::Jpeg, &one_pixel).is_ok());

        let mut invalid_wire = RemoteMessage::FrameStart(FrameDescriptor {
            frame_id: 1,
            width: 1280,
            height: 720,
            encoded_len: 1,
            chunk_count: 1,
            format: FrameFormat::Jpeg,
        })
        .encode()
        .unwrap();
        invalid_wire[9..13].copy_from_slice(&(MAX_FRAME_DIMENSION + 1).to_be_bytes());
        assert_eq!(
            RemoteMessage::decode(&invalid_wire),
            Err(ProtocolError::InvalidMessage("invalid frame descriptor"))
        );
    }

    #[test]
    fn enforces_close_reason_limit_on_send_and_receive() {
        let reason = "x".repeat(MAX_CLOSE_REASON_BYTES + 1);
        assert_eq!(
            RemoteMessage::Close(reason.clone()).encode(),
            Err(ProtocolError::InvalidMessage("close reason is too long"))
        );

        let mut wire = vec![MESSAGE_CLOSE];
        wire.extend_from_slice(reason.as_bytes());
        assert_eq!(
            RemoteMessage::decode(&wire),
            Err(ProtocolError::InvalidMessage("close reason is too long"))
        );
    }

    #[test]
    fn chunks_and_reassembles_a_large_frame() {
        let original = vec![0x5a; FRAME_CHUNK_SIZE * 2 + 17];
        let messages = frame_messages(7, 1280, 720, FrameFormat::Jpeg, &original).unwrap();
        assert_eq!(messages.len(), 4);

        let mut assembler = FrameAssembler::new();
        let mut complete = None;
        for message in messages {
            complete = assembler.push(message).unwrap().or(complete);
        }
        let complete = complete.expect("frame should complete");
        assert_eq!(complete.frame_id, 7);
        assert_eq!(complete.bytes, original);
    }

    #[test]
    fn rejects_out_of_order_chunks() {
        let original = vec![1; FRAME_CHUNK_SIZE + 1];
        let mut messages = frame_messages(1, 10, 10, FrameFormat::Jpeg, &original).unwrap();
        let mut assembler = FrameAssembler::new();
        assembler.push(messages.remove(0)).unwrap();
        let second_chunk = messages.remove(1);
        assert_eq!(
            assembler.push(second_chunk),
            Err(ProtocolError::UnexpectedChunk)
        );
    }

    #[test]
    fn input_messages_round_trip() {
        let inputs = [
            RemoteInput::MouseMove { x: 0, y: 719 },
            RemoteInput::MouseMove {
                x: u16::MAX,
                y: u16::MAX,
            },
            RemoteInput::MouseButton {
                button: PointerButton::Left,
                pressed: true,
            },
            RemoteInput::MouseButton {
                button: PointerButton::Right,
                pressed: false,
            },
            RemoteInput::Wheel {
                horizontal: false,
                units: -3,
            },
            RemoteInput::Key {
                keysym: 0x01000000 + 0x4e2d, // '中' beyond Latin-1
                pressed: true,
            },
            RemoteInput::ReleaseAll,
        ];
        for input in inputs {
            let message = RemoteMessage::Input(input);
            assert_eq!(
                RemoteMessage::decode(&message.encode().unwrap()).unwrap(),
                message
            );
        }
    }

    #[test]
    fn rejects_malformed_input_messages() {
        assert_eq!(
            RemoteMessage::Input(RemoteInput::Wheel {
                horizontal: true,
                units: 0,
            })
            .encode(),
            Err(ProtocolError::InvalidMessage("wheel units out of range"))
        );
        assert_eq!(
            RemoteMessage::Input(RemoteInput::Wheel {
                horizontal: true,
                units: MAX_WHEEL_UNITS + 1,
            })
            .encode(),
            Err(ProtocolError::InvalidMessage("wheel units out of range"))
        );

        // Unknown subkind, truncated body, bad button, non-binary boolean.
        for wire in [
            vec![6u8, 9],
            vec![6u8, 1, 0, 0, 0],
            vec![6u8, 2, 3, 1],
            vec![6u8, 2, 0, 2],
            vec![6u8],
        ] {
            assert!(RemoteMessage::decode(&wire).is_err(), "wire {wire:?}");
        }
    }

    #[test]
    fn refuses_oversized_frames() {
        let bytes = vec![0; MAX_FRAME_BYTES + 1];
        assert_eq!(
            frame_messages(1, 10, 10, FrameFormat::Jpeg, &bytes),
            Err(ProtocolError::FrameTooLarge(MAX_FRAME_BYTES + 1))
        );
    }
}
