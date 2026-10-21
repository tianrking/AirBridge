"""One serial owner for the round board's read-only display diagnostics and bounded settings."""
# Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
import argparse
import base64
import hashlib
import json
from pathlib import Path
import struct
import time
import zlib
import serial
from serial.tools import list_ports


class RoundLink:
    def __init__(self, port, identity):
        found = [p for p in list_ports.comports() if p.device == port]
        if len(found) != 1 or found[0].vid != 0x303a or found[0].pid != 0x1001 or (found[0].serial_number or '').upper() != identity.upper():
            raise RuntimeError('Explicit native-USB port and factory identity must match; no fallback port is used')
        self.port = serial.Serial(port=None, baudrate=115200, timeout=.1, write_timeout=5)
        self.port.dtr = self.port.rts = False
        self.port.port = port
        self.port.open()
        self.pending = bytearray()
        self.boots = 0
        self.port.write(b'\n')

    def close(self):
        self.port.close()

    def send(self, command):
        data = (command+'\n').encode('ascii')
        if self.port.write(data) != len(data):
            raise RuntimeError('Partial diagnostic write')

    def event(self, deadline):
        while time.monotonic() < deadline:
            if b'\n' not in self.pending:
                self.pending.extend(self.port.read(max(1, min(self.port.in_waiting, 8192))))
                if len(self.pending) > 65536:
                    raise RuntimeError('Serial framing exceeded its bound')
                continue
            raw, _, self.pending = self.pending.partition(b'\n')
            try:
                value = json.loads(raw)
            except (ValueError, UnicodeError):
                continue
            if isinstance(value, dict) and isinstance(value.get('event'), str):
                if value['event'] == 'startup_failed':
                    raise RuntimeError('Firmware startup failed at '+str(value.get('stage'))+' (code '+str(value.get('code'))+')')
                if value['event'] == 'qualification_boot':
                    self.boots += 1
                return value
        raise TimeoutError('Round board did not respond')

    def status(self):
        self.send('ROUND STATUS')
        deadline = time.monotonic()+10
        while True:
            event = self.event(deadline)
            if event['event'] == 'round_status':
                return event

    def view(self, page):
        if page not in ('home', 'devices', 'transfer', 'settings', 'peer'):
            raise ValueError('Unknown view')
        self.send('ROUND VIEW '+page)
        deadline = time.monotonic()+10
        while self.event(deadline)['event'] != 'round_view_queued':
            pass
        time.sleep(.5)

    def screenshot(self, destination):
        self.send('ROUND SCREEN')
        deadline = time.monotonic()+60
        data, frame = bytearray(), None
        while True:
            event = self.event(deadline)
            if event['event'] == 'round_capture_busy':
                raise RuntimeError('Capture already active')
            if event['event'] == 'round_frame_begin':
                if frame is not None or (event.get('width'), event.get('height'), event.get('format'), event.get('bytes')) != (360, 360, 'rgb565be', 259200):
                    raise RuntimeError('Unexpected frame layout')
                frame = event['id']
            elif event['event'] == 'round_frame_chunk':
                if frame is None or event.get('id') != frame or event.get('offset') != len(data):
                    raise RuntimeError('Missing or conflicting frame chunk')
                payload = base64.b64decode(event['data'], validate=True)
                if not payload or len(data)+len(payload) > 259200:
                    raise RuntimeError('Frame exceeds bounds')
                data.extend(payload)
            elif event['event'] == 'round_frame_end':
                if event.get('id') != frame or event.get('complete') is not True or event.get('bytes') != 259200 or len(data) != 259200:
                    raise RuntimeError('Incomplete capture; no screenshot saved')
                break
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(rgb565_png(data))
        return {'image': str(destination), 'source': 'live MCU LVGL framebuffer; not a photograph of the LCD',
                'rgb565_bytes': len(data), 'rgb565_sha256': hashlib.sha256(data).hexdigest(),
                'png_sha256': hashlib.sha256(destination.read_bytes()).hexdigest()}


def rgb565_png(pixels):
    if len(pixels) != 259200:
        raise ValueError('Expected a complete 360x360 RGB565 frame')
    rows = bytearray()
    for y in range(360):
        rows.append(0)
        for x in range(360):
            word = int.from_bytes(pixels[(y*360+x)*2:(y*360+x)*2+2], 'big')
            rows.extend((((word >> 11) & 31)*255//31, ((word >> 5) & 63)*255//63, (word & 31)*255//31))
    def chunk(kind, body):
        return struct.pack('>I', len(body))+kind+body+struct.pack('>I', zlib.crc32(kind+body))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR', struct.pack('>IIBBBBB',360,360,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',required=True)
    parser.add_argument('--serial',required=True,help='Explicit USB factory identity')
    sub=parser.add_subparsers(dest='command',required=True)
    sub.add_parser('status')
    screen=sub.add_parser('screen');screen.add_argument('--output',type=Path,required=True);screen.add_argument('--view',choices=['home','devices','transfer','settings','peer'])
    stability=sub.add_parser('stability');stability.add_argument('--cycles',type=int,default=20);stability.add_argument('--output',type=Path,required=True)
    brightness=sub.add_parser('brightness');brightness.add_argument('percent',type=int)
    args=parser.parse_args()
    link=RoundLink(args.port,args.serial)
    try:
        if args.command=='status':print(json.dumps(link.status(),ensure_ascii=False))
        elif args.command=='screen':
            if args.view:link.view(args.view)
            print(json.dumps(link.screenshot(args.output),ensure_ascii=False))
        elif args.command=='brightness':
            if not 10<=args.percent<=85:parser.error('Brightness must be 10..85')
            link.send('ROUND BRIGHTNESS '+str(args.percent));time.sleep(.5);print(json.dumps(link.status()))
        else:
            if not 1<=args.cycles<=1000:parser.error('Cycles must be 1..1000')
            samples=[link.status()]
            for cycle in range(args.cycles):
                for view in ('home','devices','transfer','settings','peer'):link.view(view)
                sample=link.status();samples.append(sample)
                if sample['reset_reason']!=samples[0]['reset_reason'] or sample['uptime_ms']<samples[-2]['uptime_ms'] or link.boots:
                    raise RuntimeError('Board restarted during acceptance')
                if sample['display_errors'] or sample['touch_errors']:
                    raise RuntimeError('Display or touch driver error')
                if not sample['radio_ready'] or sample['internal_free']<30000:
                    raise RuntimeError('Radio unavailable or internal heap below acceptance floor')
            link.view('home')
            result={'cycles':args.cycles,'views':args.cycles*5,'boots_observed':link.boots,'samples':samples,'physical_touch_tested':False,'native_airdrop_transfer_tested':False}
            args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(result,indent=2)+'\n')
            print(json.dumps({'cycles':args.cycles,'views':args.cycles*5,'samples':len(samples),'output':str(args.output),'final':samples[-1]}))
    finally:link.close()
