use crate::{ProtocolError, RemoteMessage};
use sha2::{Digest, Sha256};
use snow::{params::NoiseParams, Builder, TransportState};
use std::sync::{Arc, Mutex};
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::TcpStream;

const NOISE_PATTERN: &str = "Noise_XXpsk3_25519_ChaChaPoly_BLAKE2s";
const PROLOGUE: &[u8] = b"Lattice Remote v1 direct view-only";
const MAX_WIRE_MESSAGE: usize = 65_535;
const MAX_PLAINTEXT: usize = MAX_WIRE_MESSAGE - 16;

#[derive(Debug, Error)]
pub enum RemoteError {
    #[error("pairing code must contain exactly eight digits")]
    InvalidPairingCode,
    #[error("connection closed")]
    ConnectionClosed,
    #[error("wire message is too large")]
    MessageTooLarge,
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("secure pairing failed")]
    Pairing,
    #[error("protocol error: {0}")]
    Protocol(#[from] ProtocolError),
}

pub fn normalize_pairing_code(input: &str) -> Result<String, RemoteError> {
    let normalized: String = input
        .chars()
        .filter(|character| *character != '-' && !character.is_ascii_whitespace())
        .collect();
    if normalized.len() == 8 && normalized.bytes().all(|byte| byte.is_ascii_digit()) {
        Ok(normalized)
    } else {
        Err(RemoteError::InvalidPairingCode)
    }
}

fn pairing_key(input: &str) -> Result<[u8; 32], RemoteError> {
    let code = normalize_pairing_code(input)?;
    let mut digest = Sha256::new();
    digest.update(b"lattice-remote-pairing-v1:");
    digest.update(code.as_bytes());
    Ok(digest.finalize().into())
}

pub fn generate_pairing_code() -> Result<String, RemoteError> {
    let params: NoiseParams = NOISE_PATTERN.parse().map_err(|_| RemoteError::Pairing)?;
    let keypair = Builder::new(params)
        .generate_keypair()
        .map_err(|_| RemoteError::Pairing)?;
    let bytes: [u8; 4] = keypair.private[..4]
        .try_into()
        .map_err(|_| RemoteError::Pairing)?;
    Ok(format!("{:08}", u32::from_be_bytes(bytes) % 100_000_000))
}

pub struct SecureConnection {
    stream: TcpStream,
    transport: TransportState,
}

impl SecureConnection {
    pub async fn connect(host: &str, port: u16, pairing_code: &str) -> Result<Self, RemoteError> {
        let stream = TcpStream::connect((host, port)).await?;
        Self::initiate(stream, pairing_code).await
    }

    pub async fn initiate(mut stream: TcpStream, pairing_code: &str) -> Result<Self, RemoteError> {
        stream.set_nodelay(true)?;
        let psk = pairing_key(pairing_code)?;
        let params: NoiseParams = NOISE_PATTERN.parse().map_err(|_| RemoteError::Pairing)?;
        let keypair = Builder::new(params.clone())
            .generate_keypair()
            .map_err(|_| RemoteError::Pairing)?;
        let builder = Builder::new(params)
            .prologue(PROLOGUE)
            .map_err(|_| RemoteError::Pairing)?
            .local_private_key(&keypair.private)
            .map_err(|_| RemoteError::Pairing)?
            .psk(3, &psk)
            .map_err(|_| RemoteError::Pairing)?;
        let mut handshake = builder
            .build_initiator()
            .map_err(|_| RemoteError::Pairing)?;
        let mut write_buffer = vec![0u8; 1024];
        let mut read_buffer = vec![0u8; 1024];

        let written = handshake
            .write_message(&[], &mut write_buffer)
            .map_err(|_| RemoteError::Pairing)?;
        write_wire(&mut stream, &write_buffer[..written]).await?;

        let response = read_wire(&mut stream).await?;
        handshake
            .read_message(&response, &mut read_buffer)
            .map_err(|_| RemoteError::Pairing)?;

        let written = handshake
            .write_message(&[], &mut write_buffer)
            .map_err(|_| RemoteError::Pairing)?;
        write_wire(&mut stream, &write_buffer[..written]).await?;

        let transport = handshake
            .into_transport_mode()
            .map_err(|_| RemoteError::Pairing)?;
        Ok(Self { stream, transport })
    }

    pub async fn accept(mut stream: TcpStream, pairing_code: &str) -> Result<Self, RemoteError> {
        stream.set_nodelay(true)?;
        let psk = pairing_key(pairing_code)?;
        let params: NoiseParams = NOISE_PATTERN.parse().map_err(|_| RemoteError::Pairing)?;
        let keypair = Builder::new(params.clone())
            .generate_keypair()
            .map_err(|_| RemoteError::Pairing)?;
        let builder = Builder::new(params)
            .prologue(PROLOGUE)
            .map_err(|_| RemoteError::Pairing)?
            .local_private_key(&keypair.private)
            .map_err(|_| RemoteError::Pairing)?
            .psk(3, &psk)
            .map_err(|_| RemoteError::Pairing)?;
        let mut handshake = builder
            .build_responder()
            .map_err(|_| RemoteError::Pairing)?;
        let mut write_buffer = vec![0u8; 1024];
        let mut read_buffer = vec![0u8; 1024];

        let request = read_wire(&mut stream).await?;
        handshake
            .read_message(&request, &mut read_buffer)
            .map_err(|_| RemoteError::Pairing)?;

        let written = handshake
            .write_message(&[], &mut write_buffer)
            .map_err(|_| RemoteError::Pairing)?;
        write_wire(&mut stream, &write_buffer[..written]).await?;

        let request = read_wire(&mut stream).await?;
        handshake
            .read_message(&request, &mut read_buffer)
            .map_err(|_| RemoteError::Pairing)?;

        let transport = handshake
            .into_transport_mode()
            .map_err(|_| RemoteError::Pairing)?;
        Ok(Self { stream, transport })
    }

    pub async fn send(&mut self, message: &RemoteMessage) -> Result<(), RemoteError> {
        let encrypted = seal(&mut self.transport, message)?;
        write_wire(&mut self.stream, &encrypted).await
    }

    pub async fn receive(&mut self) -> Result<RemoteMessage, RemoteError> {
        let encrypted = read_wire(&mut self.stream).await?;
        open(&mut self.transport, &encrypted)
    }

    /// Splits the connection so one task can receive while another sends.
    ///
    /// Noise keeps independent cipher states per direction, so this is safe
    /// as long as each direction stays single-tasked — which the halves
    /// enforce by taking `&mut self`. The shared mutex only serialises the
    /// brief non-async encrypt/decrypt calls.
    pub fn split(self) -> (SecureReader, SecureWriter) {
        let (read_half, write_half) = self.stream.into_split();
        let transport = Arc::new(Mutex::new(self.transport));
        (
            SecureReader {
                stream: read_half,
                transport: Arc::clone(&transport),
            },
            SecureWriter {
                stream: write_half,
                transport,
            },
        )
    }
}

pub struct SecureReader {
    stream: OwnedReadHalf,
    transport: Arc<Mutex<TransportState>>,
}

impl SecureReader {
    pub async fn receive(&mut self) -> Result<RemoteMessage, RemoteError> {
        let encrypted = read_wire(&mut self.stream).await?;
        let mut transport = self.transport.lock().map_err(|_| RemoteError::Pairing)?;
        open(&mut transport, &encrypted)
    }
}

pub struct SecureWriter {
    stream: OwnedWriteHalf,
    transport: Arc<Mutex<TransportState>>,
}

impl SecureWriter {
    pub async fn send(&mut self, message: &RemoteMessage) -> Result<(), RemoteError> {
        let encrypted = {
            let mut transport = self.transport.lock().map_err(|_| RemoteError::Pairing)?;
            seal(&mut transport, message)?
        };
        write_wire(&mut self.stream, &encrypted).await
    }
}

fn seal(transport: &mut TransportState, message: &RemoteMessage) -> Result<Vec<u8>, RemoteError> {
    let plaintext = message.encode()?;
    if plaintext.len() > MAX_PLAINTEXT {
        return Err(RemoteError::MessageTooLarge);
    }
    let mut encrypted = vec![0u8; plaintext.len() + 16];
    let written = transport
        .write_message(&plaintext, &mut encrypted)
        .map_err(|_| RemoteError::Pairing)?;
    encrypted.truncate(written);
    Ok(encrypted)
}

fn open(transport: &mut TransportState, encrypted: &[u8]) -> Result<RemoteMessage, RemoteError> {
    let mut plaintext = vec![0u8; encrypted.len()];
    let read = transport
        .read_message(encrypted, &mut plaintext)
        .map_err(|_| RemoteError::Pairing)?;
    RemoteMessage::decode(&plaintext[..read]).map_err(RemoteError::from)
}

async fn write_wire<W: AsyncWrite + Unpin>(
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

async fn read_wire<R: AsyncRead + Unpin>(stream: &mut R) -> Result<Vec<u8>, RemoteError> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{RemoteHello, PROTOCOL_VERSION};
    use tokio::net::TcpListener;

    #[test]
    fn accepts_human_friendly_pairing_code() {
        assert_eq!(normalize_pairing_code("1234-5678").unwrap(), "12345678");
        assert_eq!(normalize_pairing_code(" 1234 5678 ").unwrap(), "12345678");
        assert!(normalize_pairing_code("1234567").is_err());
        assert!(normalize_pairing_code("1234abcd").is_err());
    }

    #[test]
    fn generated_pairing_code_has_eight_digits() {
        let code = generate_pairing_code().unwrap();
        assert_eq!(code.len(), 8);
        assert!(code.bytes().all(|byte| byte.is_ascii_digit()));
    }

    #[tokio::test]
    async fn encrypted_peers_exchange_protocol_messages() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();

        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut secure = SecureConnection::accept(stream, "12345678").await.unwrap();
            secure
                .send(&RemoteMessage::Hello(RemoteHello {
                    protocol_version: PROTOCOL_VERSION,
                    agent_name: "Test agent".into(),
                    width: 640,
                    height: 360,
                    view_only: true,
                }))
                .await
                .unwrap();
            assert_eq!(secure.receive().await.unwrap(), RemoteMessage::KeepAlive);
        });

        let stream = TcpStream::connect(address).await.unwrap();
        let mut client = SecureConnection::initiate(stream, "1234-5678")
            .await
            .unwrap();
        let hello = client.receive().await.unwrap();
        assert!(matches!(hello, RemoteMessage::Hello(_)));
        client.send(&RemoteMessage::KeepAlive).await.unwrap();
        server.await.unwrap();
    }

    #[tokio::test]
    async fn split_halves_exchange_messages_in_both_directions() {
        use crate::{PointerButton, RemoteInput};

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();

        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let secure = SecureConnection::accept(stream, "12345678").await.unwrap();
            let (mut reader, mut writer) = secure.split();
            // Send frames from one task while the other consumes input.
            let sender = tokio::spawn(async move {
                for _ in 0..3 {
                    writer.send(&RemoteMessage::KeepAlive).await.unwrap();
                }
                writer
                    .send(&RemoteMessage::Close("done".into()))
                    .await
                    .unwrap();
            });
            let mut inputs = Vec::new();
            while let Ok(RemoteMessage::Input(input)) = reader.receive().await {
                inputs.push(input);
                if inputs.len() == 2 {
                    break;
                }
            }
            sender.await.unwrap();
            inputs
        });

        let stream = TcpStream::connect(address).await.unwrap();
        let client = SecureConnection::initiate(stream, "1234-5678")
            .await
            .unwrap();
        let (mut reader, mut writer) = client.split();
        writer
            .send(&RemoteMessage::Input(RemoteInput::MouseMove {
                x: 10,
                y: 20,
            }))
            .await
            .unwrap();
        writer
            .send(&RemoteMessage::Input(RemoteInput::MouseButton {
                button: PointerButton::Left,
                pressed: true,
            }))
            .await
            .unwrap();
        let mut closes = 0;
        loop {
            match reader.receive().await.unwrap() {
                RemoteMessage::Close(reason) => {
                    assert_eq!(reason, "done");
                    closes += 1;
                    break;
                }
                RemoteMessage::KeepAlive => {}
                other => panic!("unexpected message: {other:?}"),
            }
        }
        assert_eq!(closes, 1);
        assert_eq!(
            server.await.unwrap(),
            vec![
                RemoteInput::MouseMove { x: 10, y: 20 },
                RemoteInput::MouseButton {
                    button: PointerButton::Left,
                    pressed: true,
                },
            ],
        );
    }

    #[tokio::test]
    async fn wrong_pairing_code_is_rejected_by_responder() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            SecureConnection::accept(stream, "11112222").await
        });

        let stream = TcpStream::connect(address).await.unwrap();
        let initiator = SecureConnection::initiate(stream, "33334444").await;
        let responder = server.await.unwrap();
        assert!(initiator.is_ok());
        assert!(responder.is_err());
    }
}
