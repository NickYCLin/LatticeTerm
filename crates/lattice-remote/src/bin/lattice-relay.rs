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
    client_ip_header: Option<String>,
}

fn help() -> &'static str {
    "Lattice Remote relay server\n\n\
Usage: lattice-relay [--bind ADDRESS:PORT] [--state FILE] [--client-ip-header NAME]\n\n\
Agents register their device ID over an outbound connection; viewers dial an\n\
ID and the relay pipes the two sockets together. All session traffic stays\n\
end-to-end encrypted between the peers. --state persists which token owns\n\
each device ID across restarts (only salted hashes are written). One listener\n\
accepts native TCP and WebSocket upgrades. Bind to loopback behind HTTPS/WSS\n\
ingress for public use; raw TCP is intended for trusted private networks.\n\n\
--client-ip-header names the request header the ingress sets to the real\n\
client address, such as Cf-Connecting-Ip behind Cloudflare or X-Real-Ip\n\
behind nginx. Without it every proxied client looks like 127.0.0.1 and the\n\
per-IP connection limit exempts them all. Set it only when the proxy in\n\
front replaces that header rather than appending to whatever the client\n\
sent, and only when the proxy reaches the relay over loopback: a header from\n\
any other peer is ignored, so nobody can pick their own rate-limit bucket.\n"
}

fn parse_options() -> Result<Options, String> {
    let mut bind: SocketAddr = format!("0.0.0.0:{DEFAULT_RELAY_PORT}")
        .parse()
        .expect("default address is valid");
    let mut state = None;
    let mut client_ip_header = None;
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
            "--client-ip-header" => {
                let name = arguments
                    .next()
                    .ok_or_else(|| "--client-ip-header needs a header name".to_string())?;
                if name.trim().is_empty() {
                    return Err("--client-ip-header needs a header name".to_string());
                }
                client_ip_header = Some(name);
            }
            "--help" | "-h" => {
                print!("{}", help());
                std::process::exit(0);
            }
            unknown => return Err(format!("unknown option: {unknown}")),
        }
    }
    Ok(Options {
        bind,
        state,
        client_ip_header,
    })
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
    // Say the trust boundary out loud at startup: an operator who points this
    // at a header their ingress does not actually set would otherwise believe
    // proxied traffic is rate limited when it is still exempt.
    if let Some(header) = &options.client_ip_header {
        println!("Trusting the {header} header from loopback proxies for per-IP rate limiting.");
    }
    let state = Arc::new(
        RelayState::new(options.state).trusting_forwarded_ip_header(options.client_ip_header),
    );

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
