//! Lattice Remote v1.
//!
//! The first protocol deliberately has a narrow boundary: direct TCP,
//! one-time pairing, encrypted transport, and view-only JPEG frames. It does
//! not inject input, persist a secret, discover devices, or expose a relay.

mod protocol;
mod secure;

pub use protocol::{
    frame_messages, CompleteFrame, FrameAssembler, FrameDescriptor, FrameFormat, ProtocolError,
    RemoteHello, RemoteMessage, DEFAULT_PORT, FRAME_CHUNK_SIZE, MAX_AGENT_NAME_BYTES,
    MAX_CLOSE_REASON_BYTES, MAX_FRAME_BYTES, MAX_FRAME_DIMENSION, MAX_FRAME_PIXELS,
    PROTOCOL_VERSION,
};
pub use secure::{generate_pairing_code, normalize_pairing_code, RemoteError, SecureConnection};
