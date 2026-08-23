//! Linux WebKitGTK renderer compatibility defaults.
//!
//! WebKitGTK can fail to create a GBM/EGL display with the proprietary NVIDIA
//! stack on X11. Disabling DMA-BUF alone lets the process start but may still
//! leave the webview transparent; using Mesa software rendering as well keeps
//! the application usable. Existing environment variables are always
//! respected so users and packagers can opt into a different renderer.

use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::Command;

const NVIDIA_DRIVER_VERSION: &str = "/proc/driver/nvidia/version";
const DISABLE_DMABUF: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
const SOFTWARE_GL: &str = "LIBGL_ALWAYS_SOFTWARE";

fn compatibility_defaults(
    nvidia_driver_present: bool,
    x11_session: bool,
    disable_dmabuf_is_set: bool,
    software_gl_is_set: bool,
) -> (bool, bool) {
    let affected = nvidia_driver_present && x11_session;
    (
        affected && !disable_dmabuf_is_set,
        affected && !software_gl_is_set,
    )
}

/// Restarts once with compatibility variables present before WebKitGTK loads.
///
/// Some NVIDIA/X11 stacks initialise EGL before Rust reaches `main`, so merely
/// changing the current process environment is too late. `exec` replaces the
/// process before Tauri creates a webview; existing environment overrides are
/// preserved, and the second invocation sees both variables and continues.
pub fn restart_if_needed() -> Result<(), String> {
    let nvidia_driver_present = Path::new(NVIDIA_DRIVER_VERSION).exists();
    let x11_session = std::env::var_os("XDG_SESSION_TYPE")
        .is_some_and(|value| value.eq_ignore_ascii_case("x11"))
        || std::env::var_os("GDK_BACKEND").is_some_and(|value| value.eq_ignore_ascii_case("x11"));
    let (set_disable_dmabuf, set_software_gl) = compatibility_defaults(
        nvidia_driver_present,
        x11_session,
        std::env::var_os(DISABLE_DMABUF).is_some(),
        std::env::var_os(SOFTWARE_GL).is_some(),
    );

    if !set_disable_dmabuf && !set_software_gl {
        return Ok(());
    }

    let executable = std::env::current_exe()
        .map_err(|error| format!("could not resolve the current executable: {error}"))?;
    let mut command = Command::new(executable);
    command.args(std::env::args_os().skip(1));
    if set_disable_dmabuf {
        command.env(DISABLE_DMABUF, "1");
    }
    if set_software_gl {
        command.env(SOFTWARE_GL, "1");
    }

    Err(command.exec().to_string())
}

#[cfg(test)]
mod tests {
    use super::compatibility_defaults;

    #[test]
    fn enables_both_defaults_for_nvidia_x11() {
        assert_eq!(
            compatibility_defaults(true, true, false, false),
            (true, true)
        );
    }

    #[test]
    fn leaves_other_linux_renderers_unchanged() {
        assert_eq!(
            compatibility_defaults(false, true, false, false),
            (false, false)
        );
        assert_eq!(
            compatibility_defaults(true, false, false, false),
            (false, false)
        );
    }

    #[test]
    fn respects_existing_user_overrides() {
        assert_eq!(
            compatibility_defaults(true, true, true, false),
            (false, true)
        );
        assert_eq!(
            compatibility_defaults(true, true, false, true),
            (true, false)
        );
        assert_eq!(
            compatibility_defaults(true, true, true, true),
            (false, false)
        );
    }
}
