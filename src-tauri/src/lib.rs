use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSummary {
    app_name: &'static str,
    version: &'static str,
    supported_protocols: [&'static str; 4],
    credential_storage_ready: bool,
}

#[tauri::command]
fn runtime_summary() -> RuntimeSummary {
    RuntimeSummary {
        app_name: "LatticeTerm",
        version: env!("CARGO_PKG_VERSION"),
        supported_protocols: ["ssh", "sftp", "rdp", "vnc"],
        credential_storage_ready: false,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![runtime_summary])
        .run(tauri::generate_context!())
        .expect("error while running LatticeTerm");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_summary_does_not_claim_secure_storage_is_ready() {
        let summary = runtime_summary();

        assert_eq!(summary.app_name, "LatticeTerm");
        assert_eq!(summary.supported_protocols, ["ssh", "sftp", "rdp", "vnc"]);
        assert!(!summary.credential_storage_ready);
    }
}
