//! Receive framing ahead of russh-sftp's decoder. Its outgoing packet limit
//! does not bound allocations made from incoming length headers.

use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

pub(crate) const MAX_SFTP_PACKET_BYTES: u32 = 1024 * 1024;

pub(crate) struct BoundedSftpStream<S> {
    inner: S,
    header: [u8; 4],
    header_read: usize,
    header_sent: usize,
    remaining: usize,
    closed: bool,
}

impl<S> BoundedSftpStream<S> {
    pub(crate) fn new(inner: S) -> Self {
        Self {
            inner,
            header: [0; 4],
            header_read: 0,
            header_sent: 0,
            remaining: 0,
            closed: false,
        }
    }
}

impl<S: AsyncRead + Unpin> AsyncRead for BoundedSftpStream<S> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        output: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        if output.remaining() == 0 || this.closed {
            return Poll::Ready(Ok(()));
        }
        while this.header_read < 4 {
            let mut input = ReadBuf::new(&mut this.header[this.header_read..]);
            match Pin::new(&mut this.inner).poll_read(cx, &mut input) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Err(error)) => {
                    this.closed = true;
                    return Poll::Ready(Err(error));
                }
                Poll::Ready(Ok(())) => {
                    let read = input.filled().len();
                    if read == 0 {
                        this.closed = true;
                        return Poll::Ready(if this.header_read == 0 {
                            Ok(())
                        } else {
                            Err(io::Error::new(
                                io::ErrorKind::UnexpectedEof,
                                "truncated SFTP header",
                            ))
                        });
                    }
                    this.header_read += read;
                }
            }
        }
        if this.header_sent == 0 {
            let length = u32::from_be_bytes(this.header);
            if length == 0 || length > MAX_SFTP_PACKET_BYTES {
                // Subsequent reads return EOF so the dependency's error loop
                // terminates instead of repeatedly logging the same error.
                this.closed = true;
                return Poll::Ready(Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "SFTP response exceeds the receive packet limit",
                )));
            }
            this.remaining = length as usize;
        }
        if this.header_sent < 4 {
            let count = (4 - this.header_sent).min(output.remaining());
            output.put_slice(&this.header[this.header_sent..this.header_sent + count]);
            this.header_sent += count;
            return Poll::Ready(Ok(()));
        }
        let capacity = this.remaining.min(output.remaining());
        let mut input = ReadBuf::new(output.initialize_unfilled_to(capacity));
        match Pin::new(&mut this.inner).poll_read(cx, &mut input) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Err(error)) => {
                this.closed = true;
                Poll::Ready(Err(error))
            }
            Poll::Ready(Ok(())) => {
                let count = input.filled().len();
                if count == 0 {
                    this.closed = true;
                    return Poll::Ready(Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "truncated SFTP packet",
                    )));
                }
                output.advance(count);
                this.remaining -= count;
                if this.remaining == 0 {
                    this.header_read = 0;
                    this.header_sent = 0;
                }
                Poll::Ready(Ok(()))
            }
        }
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for BoundedSftpStream<S> {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bytes: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.get_mut().inner).poll_write(cx, bytes)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_shutdown(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn rejects_an_oversized_header_without_reading_a_body() {
        let (mut peer, stream) = tokio::io::duplex(8);
        peer.write_all(&u32::MAX.to_be_bytes()).await.unwrap();
        let mut bounded = BoundedSftpStream::new(stream);
        let mut header = [0; 4];
        let error = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            bounded.read_exact(&mut header),
        )
        .await
        .unwrap()
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        assert_eq!(bounded.read(&mut header).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn preserves_fragmented_consecutive_packets_and_writes() {
        let (mut peer, stream) = tokio::io::duplex(8);
        let expected = [0, 0, 0, 3, 101, 2, 3, 0, 0, 0, 1, 102];
        let task = tokio::spawn(async move {
            for byte in expected {
                peer.write_all(&[byte]).await.unwrap();
                tokio::task::yield_now().await;
            }
            peer.shutdown().await.unwrap();
            let mut reply = [0; 2];
            peer.read_exact(&mut reply).await.unwrap();
            assert_eq!(reply, [7, 8]);
        });
        let mut bounded = BoundedSftpStream::new(stream);
        let mut received = Vec::new();
        bounded.read_to_end(&mut received).await.unwrap();
        assert_eq!(received, expected);
        bounded.write_all(&[7, 8]).await.unwrap();
        bounded.shutdown().await.unwrap();
        task.await.unwrap();
    }

    #[tokio::test]
    async fn rejects_zero_length_and_truncated_packets() {
        for bytes in [&[0, 0, 0, 0][..], &[0, 0][..], &[0, 0, 0, 4, 1][..]] {
            let mut stream = BoundedSftpStream::new(bytes);
            assert!(stream.read_to_end(&mut Vec::new()).await.is_err());
        }
    }
}
