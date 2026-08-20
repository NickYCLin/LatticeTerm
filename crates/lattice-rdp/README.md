# Lattice RDP engine

This process isolates IronRDP from LatticeTerm's SSH dependency graph. It uses
newline-delimited JSON over stdin/stdout, so credentials never appear in the
process arguments. The parent application is responsible for starting and
stopping it; the engine accepts exactly one RDP session per process.

Build it with:

```sh
cargo build --manifest-path crates/lattice-rdp/Cargo.toml
```
