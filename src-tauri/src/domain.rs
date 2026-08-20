//! Connection domain models and validation rules for LatticeTerm.
//!
//! Strictly non-secret: profiles hold target host metadata and organizational
//! attributes only. Passwords, private keys, and passphrases are never stored
//! or processed in connection profile structures.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const UNGROUPED: &str = "Ungrouped";

pub const MAX_NAME_LENGTH: usize = 60;
pub const MAX_HOSTNAME_LENGTH: usize = 253;
pub const MAX_USERNAME_LENGTH: usize = 64;
pub const MAX_GROUP_LENGTH: usize = 40;
pub const MAX_TAG_LENGTH: usize = 24;
pub const MAX_TAG_COUNT: usize = 6;
pub const MIN_PORT: u16 = 1;
pub const MAX_PORT: u16 = 65535;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    Ssh,
    Sftp,
    Rdp,
    Vnc,
}

impl Protocol {
    pub fn default_port(&self) -> u16 {
        match self {
            Protocol::Ssh => 22,
            Protocol::Sftp => 22,
            Protocol::Rdp => 3389,
            Protocol::Vnc => 5900,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Protocol::Ssh => "ssh",
            Protocol::Sftp => "sftp",
            Protocol::Rdp => "rdp",
            Protocol::Vnc => "vnc",
        }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Environment {
    Production,
    Staging,
    Development,
    #[default]
    Unassigned,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub protocol: Protocol,
    pub hostname: String,
    pub username: String,
    pub port: u16,
    pub environment: Environment,
    pub group: String,
    pub tags: Vec<String>,
    pub favorite: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionDraft {
    pub name: String,
    pub protocol: Protocol,
    pub hostname: String,
    #[serde(default)]
    pub username: String,
    pub port: u16,
    #[serde(default)]
    pub environment: Environment,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub favorite: bool,
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationErrors {
    pub name: Option<String>,
    pub hostname: Option<String>,
    pub username: Option<String>,
    pub port: Option<String>,
    pub group: Option<String>,
    pub tags: Option<String>,
}

impl ValidationErrors {
    pub fn is_empty(&self) -> bool {
        self.name.is_none()
            && self.hostname.is_none()
            && self.username.is_none()
            && self.port.is_none()
            && self.group.is_none()
            && self.tags.is_none()
    }
}

pub fn parse_tags<I, S>(input: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut seen = HashSet::new();
    let mut tags = Vec::new();

    for item in input {
        for part in item.as_ref().split(&[',', '\n'][..]) {
            let trimmed = part.trim();
            if !trimmed.is_empty() {
                let normalized = trimmed
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join("-")
                    .to_lowercase();
                if !normalized.is_empty() && seen.insert(normalized.clone()) {
                    tags.push(normalized);
                }
            }
        }
    }

    tags
}

pub fn validate_connection_draft(draft: &ConnectionDraft) -> ValidationErrors {
    let mut errors = ValidationErrors::default();
    let name = draft.name.trim();
    let hostname = draft.hostname.trim();
    let username = draft.username.trim();
    let group = draft.group.as_deref().unwrap_or("").trim();
    let tags = parse_tags(&draft.tags);

    if name.is_empty() {
        errors.name = Some("Enter a display name.".to_string());
    } else if name.chars().count() > MAX_NAME_LENGTH {
        errors.name = Some(format!("Use {MAX_NAME_LENGTH} characters or fewer."));
    }

    if hostname.is_empty() {
        errors.hostname = Some("Enter a hostname or IP address.".to_string());
    } else if hostname.contains(char::is_whitespace) {
        errors.hostname = Some("Hostnames cannot contain spaces.".to_string());
    } else if hostname.contains("://") {
        errors.hostname = Some("Enter the host only, without a scheme such as ssh://.".to_string());
    } else if hostname.contains('/') {
        errors.hostname = Some("Enter the host only, without a path.".to_string());
    } else if hostname.contains('@') {
        errors.hostname = Some("Put the account in the username field, not the host.".to_string());
    } else if !hostname.chars().all(|c| {
        c.is_ascii_alphanumeric()
            || c == '.'
            || c == '_'
            || c == ':'
            || c == '-'
            || c == '['
            || c == ']'
            || c == '%'
    }) {
        errors.hostname = Some("Use letters, digits, dots, colons or hyphens.".to_string());
    } else if hostname.chars().count() > MAX_HOSTNAME_LENGTH {
        errors.hostname = Some(format!("Use {MAX_HOSTNAME_LENGTH} characters or fewer."));
    }

    if username.contains(char::is_whitespace) {
        errors.username = Some("Usernames cannot contain spaces.".to_string());
    } else if username.chars().count() > MAX_USERNAME_LENGTH {
        errors.username = Some(format!("Use {MAX_USERNAME_LENGTH} characters or fewer."));
    }

    if !(MIN_PORT..=MAX_PORT).contains(&draft.port) {
        errors.port = Some(format!("Use a port between {MIN_PORT} and {MAX_PORT}."));
    }

    if group.chars().count() > MAX_GROUP_LENGTH {
        errors.group = Some(format!("Use {MAX_GROUP_LENGTH} characters or fewer."));
    }

    if tags.len() > MAX_TAG_COUNT {
        errors.tags = Some(format!("Use {MAX_TAG_COUNT} tags or fewer."));
    } else if tags.iter().any(|t| t.chars().count() > MAX_TAG_LENGTH) {
        errors.tags = Some(format!(
            "Each tag must be {MAX_TAG_LENGTH} characters or fewer."
        ));
    }

    errors
}

impl ConnectionProfile {
    pub fn from_draft(draft: ConnectionDraft, id: String) -> Self {
        let group = draft.group.unwrap_or_default().trim().to_string();
        let group_name = if group.is_empty() {
            UNGROUPED.to_string()
        } else {
            group
        };

        ConnectionProfile {
            id,
            name: draft.name.trim().to_string(),
            protocol: draft.protocol,
            hostname: draft.hostname.trim().to_string(),
            username: draft.username.trim().to_string(),
            port: draft.port,
            environment: draft.environment,
            group: group_name,
            tags: parse_tags(&draft.tags),
            favorite: draft.favorite,
        }
    }

    pub fn target_string(&self) -> String {
        if self.username.is_empty() {
            format!("{}:{}", self.hostname, self.port)
        } else {
            format!("{}@{}:{}", self.username, self.hostname, self.port)
        }
    }
}
