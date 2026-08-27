//! Length-prefixed framing shared by the encrypted transport and the plaintext
//! relay rendezvous exchange: a `u32` big-endian length followed by the bytes.

use crate::secure::RemoteError;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub(crate) const MAX_WIRE_MESSAGE: usize = 65_535;

pub(crate) async fn write_wire<W: AsyncWrite + Unpin>(
    stream: &mut W,
    bytes: &[u8],
) -> Result<(), RemoteError> {
    if bytes.is_empty() || bytes.len() > MAX_WIRE_MESSAGE {
        return Err(RemoteError::MessageTooLarge);
    }
    stream.write_u32(bytes.len() as u32).await?;
    stream.write_all(bytes).await?;
    stream.flush().await?;
    Ok(())
}

pub(crate) async fn read_wire<R: AsyncRead + Unpin>(
    stream: &mut R,
) -> Result<Vec<u8>, RemoteError> {
    let length = match stream.read_u32().await {
        Ok(length) => length as usize,
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
            return Err(RemoteError::ConnectionClosed)
        }
        Err(error) => return Err(RemoteError::Io(error)),
    };
    if length == 0 || length > MAX_WIRE_MESSAGE {
        return Err(RemoteError::MessageTooLarge);
    }
    let mut bytes = vec![0u8; length];
    stream.read_exact(&mut bytes).await?;
    Ok(bytes)
}
