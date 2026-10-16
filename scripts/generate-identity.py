"""Generate an untracked build-local AirDrop TLS identity; never export its key."""
# Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
import datetime
import sys
from pathlib import Path
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

destination = Path(sys.argv[1])
if not destination.exists():
    key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "AirBridge PC")])
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(datetime.datetime(2020, 1, 1, tzinfo=datetime.timezone.utc))
            .not_valid_after(datetime.datetime(2040, 1, 1, tzinfo=datetime.timezone.utc))
            .sign(key, hashes.SHA256()))
    public = cert.public_bytes(serialization.Encoding.PEM).decode("ascii")
    private = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                               serialization.NoEncryption()).decode("ascii")
    destination.write_text('#pragma once\nnamespace identity_assets {\n'
                           'inline constexpr char certificate[]=R"PEM(' + public + ')PEM";\n'
                           'inline constexpr char private_key[]=R"PEM(' + private + ')PEM";\n}\n',
                           encoding="ascii")
