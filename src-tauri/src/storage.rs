//! Storage trait and in-memory baseline for LatticeTerm.
//!
//! Provides a safe boundary for connection profile storage, separating
//! metadata persistence from secret storage (Stronghold / OS Keychain).

use crate::domain::ConnectionProfile;
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StorageError {
    NotFound(String),
    Validation(String),
    Internal(String),
}

impl std::fmt::Display for StorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StorageError::NotFound(id) => write!(f, "Profile with ID '{id}' not found"),
            StorageError::Validation(msg) => write!(f, "Validation error: {msg}"),
            StorageError::Internal(msg) => write!(f, "Storage internal error: {msg}"),
        }
    }
}

impl std::error::Error for StorageError {}

pub trait Storage: Send + Sync {
    fn list_profiles(&self) -> Result<Vec<ConnectionProfile>, StorageError>;
    fn get_profile(&self, id: &str) -> Result<Option<ConnectionProfile>, StorageError>;
    fn insert_profile(&mut self, profile: ConnectionProfile) -> Result<(), StorageError>;
    fn update_profile(&mut self, profile: ConnectionProfile) -> Result<(), StorageError>;
    fn delete_profile(&mut self, id: &str) -> Result<bool, StorageError>;
}

#[derive(Debug, Default, Clone)]
pub struct InMemoryStorage {
    profiles: HashMap<String, ConnectionProfile>,
}

impl InMemoryStorage {
    pub fn new() -> Self {
        Self {
            profiles: HashMap::new(),
        }
    }
}

impl Storage for InMemoryStorage {
    fn list_profiles(&self) -> Result<Vec<ConnectionProfile>, StorageError> {
        let mut list: Vec<ConnectionProfile> = self.profiles.values().cloned().collect();
        list.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(list)
    }

    fn get_profile(&self, id: &str) -> Result<Option<ConnectionProfile>, StorageError> {
        Ok(self.profiles.get(id).cloned())
    }

    fn insert_profile(&mut self, profile: ConnectionProfile) -> Result<(), StorageError> {
        self.profiles.insert(profile.id.clone(), profile);
        Ok(())
    }

    fn update_profile(&mut self, profile: ConnectionProfile) -> Result<(), StorageError> {
        if !self.profiles.contains_key(&profile.id) {
            return Err(StorageError::NotFound(profile.id));
        }
        self.profiles.insert(profile.id.clone(), profile);
        Ok(())
    }

    fn delete_profile(&mut self, id: &str) -> Result<bool, StorageError> {
        Ok(self.profiles.remove(id).is_some())
    }
}
