"""Stage a checked file over serial, then send it through the board's native AirDrop client."""
# Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
import argparse
import json
from pathlib import Path

from bridge_client import BridgeClient, open_authorized_port


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file', type=Path)
    parser.add_argument('--peer', required=True, help='Fresh advertised Apple AWDL MAC')
    parser.add_argument('--port', type=int, default=8770, help='Peer AirDrop TCP port')
    parser.add_argument('--uti', default='public.data')
    parser.add_argument('--directory', type=Path, default=Path('received/inbox'))
    parser.add_argument('--log', type=Path, default=Path('work/duplex.jsonl'))
    parser.add_argument('--listen-after', action='store_true', help='Keep this same serial owner receiving after the send')
    args = parser.parse_args()
    args.log.parent.mkdir(parents=True, exist_ok=True)
    with open_authorized_port() as connection, args.log.open('w', encoding='utf-8') as log:
        client = BridgeClient(connection, args.directory, log)
        try:
            print(json.dumps(dict(client.hello(), event='device_capabilities'), ensure_ascii=False), flush=True)
            expected = client.stage_file(args.file, args.peer, args.port, args.uti)
            client.send_staged(expected)
            print(json.dumps(dict(event='native_send_http_completed', **expected, destination_sha256_verified=False)), flush=True)
            if args.listen_after:
                while True:
                    client.poll()
        except KeyboardInterrupt:
            if client.capabilities is not None:
                client.request('CANCEL')
            raise
        finally:
            client.close()


if __name__ == '__main__':
    main()
