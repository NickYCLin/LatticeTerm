//! Byte-stream transports used by the relay protocol.
//!
//! Native deployments keep using raw TCP. WebSocket binary frames let the
//! same byte stream travel through ordinary HTTPS ingress such as Cloudflare
//! Tunnel without exposing another public port. The relay protocol and Noise
//! layer above this module see identical ordered bytes on either carrier.

use futures_util::{SinkExt as _, StreamExt as _};
use std::io;
use std::pin::Pin;
use std::task::{ready, Context, Poll};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::error::ProtocolError;
use tokio_tungstenite::tungstenite::protocol::Message;
use tokio_tungstenite::tungstenite::Error as WsError;
use tokio_tungstenite::{accept_async, connect_async, WebSocketStream};

/// A byte stream that carries relay control messages and encrypted sessions.
pub enum Transport {
    Tcp(TcpStream),
    /// Boxed so client-side TLS and server-side plaintext WebSockets share one
    /// type while still implementing Tokio's byte-stream traits.
    WebSocket(Box<dyn ByteStream>),
}

pub trait ByteStream: AsyncRead + AsyncWrite + Unpin + Send {}

impl<T: AsyncRead + AsyncWrite + Unpin + Send> ByteStream for T {}

impl Transport {
    pub fn is_websocket_endpoint(endpoint: &str) -> bool {
        let lower = endpoint.to_ascii_lowercase();
        lower.starts_with("ws://") || lower.starts_with("wss://")
    }

    /// Connects to a normalized `HOST:PORT`, `ws://`, or `wss://` endpoint.
    pub async fn connect(endpoint: &str) -> io::Result<Self> {
        if Self::is_websocket_endpoint(endpoint) {
            let (socket, _response) = connect_async(endpoint).await.map_err(handshake_error)?;
            Ok(Self::WebSocket(Box::new(WebSocketByteStream::new(socket))))
        } else {
            let stream = TcpStream::connect(endpoint).await?;
            stream.set_nodelay(true)?;
            Ok(Self::Tcp(stream))
        }
    }

    /// Completes the server side of a WebSocket upgrade from HTTPS ingress.
    pub async fn accept_websocket(stream: TcpStream) -> io::Result<Self> {
        stream.set_nodelay(true)?;
        let socket = accept_async(stream).await.map_err(handshake_error)?;
        Ok(Self::WebSocket(Box::new(WebSocketByteStream::new(socket))))
    }
}

impl From<TcpStream> for Transport {
    fn from(stream: TcpStream) -> Self {
        Self::Tcp(stream)
    }
}

macro_rules! delegate {
    ($self:ident, $stream:ident => $body:expr) => {
        match $self.get_mut() {
            Transport::Tcp($stream) => {
                let $stream = Pin::new($stream);
                $body
            }
            Transport::WebSocket($stream) => {
                let $stream = Pin::new($stream);
                $body
            }
        }
    };
}

impl AsyncRead for Transport {
    fn poll_read(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        delegate!(self, stream => stream.poll_read(context, buffer))
    }
}

impl AsyncWrite for Transport {
    fn poll_write(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &[u8],
    ) -> Poll<io::Result<usize>> {
        delegate!(self, stream => stream.poll_write(context, buffer))
    }

    fn poll_flush(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        delegate!(self, stream => stream.poll_flush(context))
    }

    fn poll_shutdown(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        delegate!(self, stream => stream.poll_shutdown(context))
    }
}

/// Presents ordered WebSocket binary frames as a continuous byte stream.
struct WebSocketByteStream<S> {
    socket: WebSocketStream<S>,
    pending: Vec<u8>,
    offset: usize,
}

impl<S> WebSocketByteStream<S> {
    fn new(socket: WebSocketStream<S>) -> Self {
        Self {
            socket,
            pending: Vec::new(),
            offset: 0,
        }
    }
}

impl<S> AsyncRead for WebSocketByteStream<S>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    fn poll_read(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        loop {
            if this.offset < this.pending.len() {
                let take = buffer.remaining().min(this.pending.len() - this.offset);
                buffer.put_slice(&this.pending[this.offset..this.offset + take]);
                this.offset += take;
                if this.offset == this.pending.len() {
                    this.pending.clear();
                    this.offset = 0;
                }
                return Poll::Ready(Ok(()));
            }
            match ready!(this.socket.poll_next_unpin(context)) {
                Some(Ok(Message::Binary(payload))) => {
                    if payload.is_empty() {
                        continue;
                    }
                    this.pending = payload.to_vec();
                    this.offset = 0;
                }
                Some(Ok(Message::Ping(_) | Message::Pong(_) | Message::Frame(_))) => continue,
                Some(Ok(Message::Close(_))) | None => return Poll::Ready(Ok(())),
                Some(Ok(Message::Text(_))) => {
                    return Poll::Ready(Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "the relay carries binary WebSocket frames only",
                    )))
                }
                Some(Err(error)) if is_peer_gone(&error) => return Poll::Ready(Ok(())),
                Some(Err(error)) => return Poll::Ready(Err(stream_error(error))),
            }
        }
    }
}

impl<S> AsyncWrite for WebSocketByteStream<S>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    fn poll_write(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &[u8],
    ) -> Poll<io::Result<usize>> {
        let this = self.get_mut();
        ready!(this.socket.poll_ready_unpin(context)).map_err(stream_error)?;
        this.socket
            .start_send_unpin(Message::Binary(buffer.to_vec().into()))
            .map_err(stream_error)?;
        Poll::Ready(Ok(buffer.len()))
    }

    fn poll_flush(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        self.get_mut()
            .socket
            .poll_flush_unpin(context)
            .map_err(stream_error)
    }

    fn poll_shutdown(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        self.get_mut()
            .socket
            .poll_close_unpin(context)
            .map_err(stream_error)
    }
}

fn is_peer_gone(error: &WsError) -> bool {
    matches!(
        error,
        WsError::ConnectionClosed
            | WsError::AlreadyClosed
            | WsError::Protocol(ProtocolError::ResetWithoutClosingHandshake)
    )
}

fn handshake_error(error: WsError) -> io::Error {
    io::Error::new(io::ErrorKind::ConnectionRefused, error)
}

fn stream_error(error: WsError) -> io::Error {
    match error {
        WsError::ConnectionClosed | WsError::AlreadyClosed => {
            io::Error::from(io::ErrorKind::BrokenPipe)
        }
        WsError::Io(error) => error,
        other => io::Error::other(other),
    }
}
