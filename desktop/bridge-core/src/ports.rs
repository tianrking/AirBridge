use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct BridgePort {
    pub port: String,
    pub usb_serial: String,
}
pub fn factory_identity(value: &str) -> bool {
    if !crate::protocol::mac(value) {
        return false;
    }
    let compact = value.replace(':', "");
    let Ok(first) = u8::from_str_radix(&compact[..2], 16) else {
        return false;
    };
    first & 1 == 0 && compact != "000000000000" && compact != "ffffffffffff"
}
pub fn available() -> Result<Vec<BridgePort>> {
    Ok(serialport::available_ports()?
        .into_iter()
        .filter_map(|p| {
            let serialport::SerialPortType::UsbPort(info) = p.port_type else {
                return None;
            };
            let serial = info.serial_number?;
            (info.vid == 0x303a && info.pid == 0x1001 && factory_identity(&serial)).then_some(
                BridgePort {
                    port: p.port_name,
                    usb_serial: serial,
                },
            )
        })
        .collect())
}
pub fn validate_selection(selection: &BridgePort, current: &[BridgePort]) -> Result<()> {
    ensure!(
        factory_identity(&selection.usb_serial)
            && current.iter().filter(|p| *p == selection).count() == 1,
        "The selected ESP32-S3 USB identity is no longer available"
    );
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn factory_ids_reject_missing_multicast_and_empty_values() {
        for id in [
            "",
            "00:00:00:00:00:00",
            "ff:ff:ff:ff:ff:ff",
            "01:11:22:33:44:55",
            "invalid",
        ] {
            assert!(!factory_identity(id));
        }
        assert!(factory_identity("A0:B7:65:12:34:56"));
    }
    #[test]
    fn selection_is_explicit_and_bound_to_the_descriptor_not_a_developer_port() {
        let selected = BridgePort {
            port: "COM19".into(),
            usb_serial: "A0:B7:65:12:34:56".into(),
        };
        assert!(validate_selection(&selected, std::slice::from_ref(&selected)).is_ok());
        let changed = BridgePort {
            usb_serial: "A0:B7:65:99:88:66".into(),
            ..selected.clone()
        };
        assert!(validate_selection(&selected, &[changed]).is_err());
        assert!(validate_selection(&selected, &[]).is_err());
    }
}
