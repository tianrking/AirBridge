// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
use anyhow::{bail, ensure, Result};
use plist::{Dictionary, Value};

pub const USB_SERIAL: &str = "F0:9E:9E:1E:61:3C";
pub const PORT: &str = "COM4";
pub const MAX_FILE: usize = 1024 * 1024;

pub fn command(sequence: u32, body: &str) -> Result<Vec<u8>> {
    ensure!(
        !body.is_empty() && body.len() <= 192,
        "Command body exceeds bound"
    );
    ensure!(
        body.bytes().all(|b| (32..=126).contains(&b) && b != b'*'),
        "Invalid command bytes"
    );
    let payload = format!("{sequence} {body}");
    let line = format!(
        "AB2 {payload} *{:08x}\n",
        crc32fast::hash(payload.as_bytes())
    );
    ensure!(line.len() <= 224, "Command record exceeds bound");
    Ok(line.into_bytes())
}

pub fn safe_name(name: &str) -> bool {
    if name.is_empty()
        || name.len() > 240
        || name.ends_with(['.', ' '])
        || name.chars().any(|c| c < ' ' || "/\\:<>\"|?*".contains(c))
    {
        return false;
    }
    let stem = name
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end()
        .to_uppercase();
    !matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) && !(stem.len() == 4
        && (stem.starts_with("COM") || stem.starts_with("LPT"))
        && matches!(stem.as_bytes()[3], b'1'..=b'9'))
        && !matches!(
            stem.as_str(),
            "COM¹" | "COM²" | "COM³" | "LPT¹" | "LPT²" | "LPT³"
        )
}

pub fn identity(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
}
pub fn mac(value: &str) -> bool {
    value.len() == 17
        && value.split(':').count() == 6
        && value
            .split(':')
            .all(|s| s.len() == 2 && s.bytes().all(|b| b.is_ascii_hexdigit()))
}
pub fn digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

#[derive(Default)]
pub struct Lines {
    pending: Vec<u8>,
    dropping: bool,
}
impl Lines {
    pub fn feed(&mut self, bytes: &[u8]) -> Result<Vec<Vec<u8>>> {
        let mut lines = Vec::new();
        for &byte in bytes {
            if self.dropping {
                if byte == b'\n' {
                    self.dropping = false;
                }
                continue;
            }
            if byte == b'\n' {
                if !self.pending.is_empty() {
                    lines.push(std::mem::take(&mut self.pending));
                }
            } else {
                if self.pending.len() == 16384 {
                    self.pending.clear();
                    self.dropping = true;
                    bail!("Serial record exceeds 16 KiB; operation outcome uncertain");
                }
                self.pending.push(byte);
            }
        }
        Ok(lines)
    }
}

pub fn manifest(name: &str, size: usize, sender: &str, transfer_id: &str) -> Result<Vec<u8>> {
    ensure!(
        safe_name(name) && size <= MAX_FILE && identity(transfer_id, 64),
        "Invalid source metadata"
    );
    ensure!(
        sender.len() == 12 && sender.bytes().all(|b| b.is_ascii_hexdigit()),
        "Invalid sender identity"
    );
    let mut file = Dictionary::new();
    file.insert("FileName".into(), name.into());
    file.insert("FileSize".into(), (size as u64).into());
    file.insert("FileType".into(), "public.data".into());
    file.insert("FileBomPath".into(), format!("./{name}").into());
    file.insert("FileIsDirectory".into(), false.into());
    file.insert("ConvertMediaFormats".into(), false.into());
    let mut transfer = Dictionary::new();
    transfer.insert("id".into(), transfer_id.into());
    let mut kind = Dictionary::new();
    kind.insert("files".into(), Value::Dictionary(Dictionary::new()));
    let mut root = Dictionary::new();
    root.insert("TransferID".into(), Value::Dictionary(transfer));
    root.insert("TransferType".into(), Value::Dictionary(kind));
    root.insert("SenderID".into(), sender.into());
    root.insert("BundleID".into(), "com.apple.finder".into());
    root.insert("SenderComputerName".into(), "AirBridge PC".into());
    root.insert("SenderModelName".into(), "Windows".into());
    root.insert("Items".into(), Value::Array(Vec::new()));
    root.insert("ConvertMediaFormats".into(), false.into());
    root.insert("Files".into(), Value::Array(vec![Value::Dictionary(file)]));
    let mut encoded = Vec::new();
    Value::Dictionary(root).to_writer_binary(&mut encoded)?;
    ensure!(encoded.len() <= 131072, "Manifest exceeds bound");
    Ok(encoded)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn literal_crc_and_bounds() {
        assert_eq!(command(17, "HELLO").unwrap(), b"AB2 17 HELLO *414b814b\n");
        for value in ["", "x\ny", "x*y", "測試"] {
            assert!(command(1, value).is_err());
        }
        assert!(command(1, &"x".repeat(193)).is_err());
    }
    #[test]
    fn filenames_are_single_windows_components() {
        for name in [
            "../x",
            "CON",
            "nul.txt",
            "COM1",
            "LPT².dat",
            "file.",
            "bad:name",
            "a/b",
        ] {
            assert!(!safe_name(name), "{name}");
        }
        assert!(safe_name("測試 & data.bin"));
    }
    #[test]
    fn fragmented_lines_and_empty_boundaries() {
        let mut lines = Lines::default();
        assert!(lines.feed(b"\n{\"ev").unwrap().is_empty());
        assert_eq!(
            lines.feed(b"ent\":1}\n\n").unwrap(),
            vec![b"{\"event\":1}".to_vec()]
        );
        assert!(lines.feed(&vec![b'a'; 16385]).is_err());
        assert_eq!(lines.feed(b"garbage\n{}\n").unwrap(), vec![b"{}".to_vec()]);
    }
    #[test]
    fn manifest_preserves_unicode_and_transfer_identity() {
        let raw = manifest("測試.bin", 262145, "020102030405", "TEST-123").unwrap();
        let decoded = Value::from_reader(std::io::Cursor::new(raw)).unwrap();
        let root = decoded.as_dictionary().unwrap();
        assert_eq!(
            root["TransferID"].as_dictionary().unwrap()["id"].as_string(),
            Some("TEST-123")
        );
        let file = root["Files"].as_array().unwrap()[0]
            .as_dictionary()
            .unwrap();
        assert_eq!(file["FileName"].as_string(), Some("測試.bin"));
        assert_eq!(file["FileSize"].as_unsigned_integer(), Some(262145));
    }
}
