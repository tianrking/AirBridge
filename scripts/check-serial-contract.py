"""Exercise staging rejection/replay on the authorized board without sending an AirDrop file."""
# Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
import argparse
import base64
import hashlib
import json
import time
from pathlib import Path

from bridge_client import BridgeClient, BridgeError, encode_command, make_manifest, open_authorized_port


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--peer', required=True)
    parser.add_argument('--log', type=Path, default=Path('work/serial-contract.jsonl'))
    args = parser.parse_args()
    args.log.parent.mkdir(parents=True, exist_ok=True)
    with open_authorized_port() as connection, args.log.open('w', encoding='utf-8') as log:
        client = BridgeClient(connection, 'received/contract', log, emit=lambda event: None)
        count = 0
        try:
            capabilities = client.hello()
            radio = capabilities['radio_mac']

            def reject(verb, arguments, reason):
                nonlocal count
                try:
                    client.request(verb, arguments)
                except BridgeError as error:
                    if not str(error).endswith(': '+reason):
                        raise
                    count += 1
                    return
                raise AssertionError('Unexpected acceptance: '+verb)

            def status(reason, offset=0):
                nonlocal count
                result = client.request('STATUS')
                assert result['reason'] == reason and result['offset'] == offset and result['radio_mac'] == radio
                count += 1

            _, metadata = make_manifest('contract.bin', 3, radio.replace(':', ''))
            begin = f'3 {len(metadata)} {"0"*64} {args.peer} 8770'
            reject('DATA', '0 YWJj', 'invalid_chunk')
            reject('BEGIN', f'1048577 {len(metadata)} {"0"*64} {args.peer} 8770', 'invalid_begin')
            status('idle')
            client.request('BEGIN', begin)
            reject('DATA', '1 YWJj', 'offset_or_length')
            status('staging', 0)
            client.request('DATA', '0 YWJj')
            repeated = client.last_command
            repeated_sequence = client.sequence
            assert connection.write(repeated) == len(repeated)
            deadline = time.monotonic()+5
            while repeated_sequence not in client.replies and time.monotonic() < deadline:
                client.poll()
            assert client.replies.pop(repeated_sequence)['offset'] == 3
            count += 1
            status('staging', 3)
            reject('SEND', '', 'incomplete_upload')
            for offset in range(0, len(metadata), 112):
                client.request('META', f'{offset} '+base64.b64encode(metadata[offset:offset+112]).decode())
            reject('SEND', '', 'sha256_mismatch')
            status('idle')
            good_hash = hashlib.sha256(b'abc').hexdigest()
            _, wrong = make_manifest('contract.bin', 4, radio.replace(':', ''))
            client.request('BEGIN', f'3 {len(wrong)} {good_hash} {args.peer} 8770')
            for offset in range(0, len(wrong), 112):
                client.request('META', f'{offset} '+base64.b64encode(wrong[offset:offset+112]).decode())
            client.request('DATA', '0 YWJj')
            reject('SEND', '', 'manifest_mismatch')
            status('idle')
            client.request('BEGIN', begin)
            client.request('CANCEL')
            reject('DATA', '0 YWJj', 'invalid_chunk')
            status('idle')
            original_session = client.session
            client.session = ('0' if original_session[0] != '0' else '1')+original_session[1:]
            reject('STATUS', '', 'session_mismatch')
            client.session = original_session
            status('idle')
            client.sequence += 1
            damaged = bytearray(encode_command(client.sequence, client.session+' STATUS'))
            damaged[-3] = ord('0') if damaged[-3] != ord('0') else ord('1')
            assert connection.write(damaged) == len(damaged)
            deadline = time.monotonic()+5
            rejected = False
            while time.monotonic() < deadline:
                try:
                    client.poll()
                except BridgeError as error:
                    assert 'framing or CRC' in str(error)
                    rejected = True
                    count += 1
                    break
            assert rejected
            status('idle')
            print(json.dumps(dict(event='serial_contract_pass', checks=count, radio_identity_unchanged=True)), flush=True)
        finally:
            client.close()


if __name__ == '__main__':
    main()
