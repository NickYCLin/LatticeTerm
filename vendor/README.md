# Vendored security patches

`glib-0.18.5` is the unmodified crates.io source except for the upstream
`VariantStrIter::impl_get` fix from gtk-rs commit `05dff0e`. GTK3 and current
Tauri releases still require the 0.18 API line, while RUSTSEC-2024-0429 marks
only 0.20 and newer as patched.

The local patch changes the C out-argument from `&p` to `&mut p`, exactly as
upstream. Retire this vendored crate when the Linux Tauri stack can depend on
`glib >= 0.20`. The original crate license and copyright files remain beside
the source.
