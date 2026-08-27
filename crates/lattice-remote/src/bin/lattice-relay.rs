//! CLI entry point for the Lattice Remote relay server. The actual protocol
//! logic lives in `lattice_remote::relay_server` so tests can exercise it.

use lattice_remote::relay::DEFAULT_RELAY_PORT;
use lattice_remote::relay_server::{run, RelayState};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::net::TcpListener;

struct Options {
    bind: SocketAddr,
    state: Option<PathBuf>,
}

fn help() -> &'static str {
    "Lattice Remote relay server\n\n\
Usage: lattice-relay [--bind ADDRESS:PORT] [--state FILE]\n\n\
Agents register their device ID over an outbound connection; viewers dial an\n\
ID and the relay pipes the two sockets together. All session traffic stays\n\
end-to-end encrypted between the peers. --state persists which token owns\n\
each device ID across restarts (only salted hashes are written). One listener\n\
accepts native TCP and WebSocket upgrades. Bind to loopback behind HTTPS/WSS\n\
ingress for public use; raw TCP is intended for trusted private networks.\n"
}

fn parse_options() -> Result<Options, String> {
    let mut bind: SocketAddr = format!("0.0.0.0:{DEFAULT_RELAY_PORT}")
        .parse()
        .expect("default address is valid");
    let mut state = None;
    let mut arguments = std::env::args().skip(1);
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--bind" => {
                bind = arguments
                    .next()
                    .ok_or_else(|| "--bind needs ADDRESS:PORT".to_string())?
                    .parse()
                    .map_err(|_| "--bind must be a valid IP_ADDRESS:PORT".to_string())?;
            }
            "--state" => {
                state = Some(PathBuf::from(
                    arguments
                        .next()
                        .ok_or_else(|| "--state needs a file path".to_string())?,
                ));
            }
            "--help" | "-h" => {
                print!("{}", help());
                std::process::exit(0);
            }
            unknown => return Err(format!("unknown option: {unknown}")),
        }
    }
    Ok(Options { bind, state })
}

#[tokio::main]
async fn main() {
    let options = match parse_options() {
        Ok(options) => options,
        Err(error) => {
            eprintln!("Error: {error}\n\n{}", help());
            std::process::exit(2);
        }
    };
    let state = Arc::new(RelayState::new(options.state));

    let listener = match TcpListener::bind(options.bind).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("Unable to listen on {}: {error}", options.bind);
            std::process::exit(1);
        }
    };
    println!("Lattice Remote relay is listening on {}.", options.bind);
    run(listener, state).await;
}
