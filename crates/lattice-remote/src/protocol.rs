use std::fmt;

pub const PROTOCOL_VERSION: u16 = 1;
pub const DEFAULT_PORT: u16 = 44_900;
pub const FRAME_CHUNK_SIZE: usize = 48 * 1024;
pub const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;

const MESSAGE_HELLO: u8 = 1;
const MESSAGE_FRAME_START: u8 = 2;
const MESSAGE_FRAME_CHUNK: u8 = 3;
const MESSAGE_KEEP_ALIVE: u8 = 4;
const MESSAGE_CLOSE: u8 = 5;

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

impl RemoteMessage {
    pub fn encode(&self) -> Result<Vec<u8>, ProtocolError> {
        match self {
            Self::Hello(hello) => {
                let name = hello.agent_name.as_bytes();
                if name.is_empty() || name.len() > u16::MAX as usize {
                    return Err(ProtocolError::InvalidHello);
                }
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
            Self::Close(reason) => {
                let bytes = reason.as_bytes();
                if bytes.len() > 1024 {
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
                if width == 0 || height == 0 {
                    return Err(ProtocolError::InvalidHello);
                }
                Ok(Self::Hello(RemoteHello {
                    protocol_version,
                    agent_name,
                    width,
                    height,
                    view_only,
                }))
            }
            MESSAGE_FRAME_START => {
                if body.len() != 23 {
                    return Err(ProtocolError::InvalidMessage("invalid frame start length"));
                }
                Ok(Self::FrameStart(FrameDescriptor {
                    frame_id: read_u64(body, 0)?,
                    width: read_u32(body, 8)?,
                    height: read_u32(body, 12)?,
                    encoded_len: read_u32(body, 16)?,
                    chunk_count: read_u16(body, 20)?,
                    format: FrameFormat::decode(body[22])?,
                }))
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
            MESSAGE_CLOSE => Ok(Self::Close(
                std::str::from_utf8(body)
                    .map_err(|_| ProtocolError::InvalidText)?
                    .to_string(),
            )),
            _ => Err(ProtocolError::InvalidMessage("unknown message type")),
        }
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

    let mut messages = Vec::with_capacity(chunks + 1);
    messages.push(RemoteMessage::FrameStart(FrameDescriptor {
        frame_id,
        width,
        height,
        encoded_len: bytes.len() as u32,
        chunk_count: chunks as u16,
        format,
    }));
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
                let encoded_len = descriptor.encoded_len as usize;
                let expected_chunks = encoded_len.div_ceil(FRAME_CHUNK_SIZE);
                if descriptor.width == 0
                    || descriptor.height == 0
                    || encoded_len == 0
                    || encoded_len > MAX_FRAME_BYTES
                    || descriptor.chunk_count as usize != expected_chunks
                {
                    return Err(ProtocolError::InvalidMessage("invalid frame descriptor"));
                }
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
    fn refuses_oversized_frames() {
        let bytes = vec![0; MAX_FRAME_BYTES + 1];
        assert_eq!(
            frame_messages(1, 10, 10, FrameFormat::Jpeg, &bytes),
            Err(ProtocolError::FrameTooLarge(MAX_FRAME_BYTES + 1))
        );
    }
}
