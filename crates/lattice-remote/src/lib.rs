//! Lattice Remote.
//!
//! The protocol keeps a narrow boundary: direct TCP, one-time pairing,
//! encrypted transport, and JPEG frames. Input injection and access to one
//! shared file root are separately opt-in per share; the agent never persists
//! a secret, discovers devices, or exposes a relay.

#[cfg(feature = "agent")]
pub mod host_files;
#[cfg(feature = "agent")]
pub mod host_input;
mod protocol;
mod secure;

pub use protocol::{
    frame_messages, CompleteFrame, FrameAssembler, FrameDescriptor, FrameFormat, PointerButton,
    ProtocolError, RemoteFileEntry, RemoteFileKind, RemoteFileRequest, RemoteFileResponse,
    RemoteHello, RemoteInput, RemoteMessage, DEFAULT_PORT, FILE_CHUNK_SIZE, FRAME_CHUNK_SIZE,
    MAX_AGENT_NAME_BYTES, MAX_CLOSE_REASON_BYTES, MAX_DIRECTORY_ENTRIES, MAX_FILE_ERROR_BYTES,
    MAX_FILE_ROOT_LABEL_BYTES, MAX_FRAME_BYTES, MAX_FRAME_DIMENSION, MAX_FRAME_PIXELS,
    MAX_REMOTE_PATH_BYTES, MAX_WHEEL_UNITS, PROTOCOL_VERSION,
};
pub use secure::{
    generate_pairing_code, normalize_pairing_code, RemoteError, SecureConnection, SecureReader,
    SecureWriter,
};
