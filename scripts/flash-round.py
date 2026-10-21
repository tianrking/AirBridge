"""Flash only an explicitly identified round board, preserving and verifying NVS."""
# Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import time
from serial.tools import list_ports


def inspect_build(build):
    description=json.loads((build/'project_description.json').read_text())
    if description.get('target')!='esp32s3' or description.get('git_revision')!='v6.1':
        raise ValueError('Expected an ESP-IDF 6.1 ESP32-S3 build')
    cache=(build/'CMakeCache.txt').read_text()
    for flag in ('AIRBRIDGE_ROUND_DISPLAY','AIRBRIDGE_PUBLIC_BUILD','AIRBRIDGE_NATIVE_SERVICE','AIRBRIDGE_PRESENCE_TX','AIRBRIDGE_IPV6_LINK'):
        if not any(flag+':BOOL='+value in cache for value in ('TRUE','ON','1')):
            raise ValueError('Required profile flag missing: '+flag)
    if 'AIRBRIDGE_PROBE_PEER:STRING=\n' not in cache:
        raise ValueError('Round build must not embed a private Apple peer')
    config=(build/'sdkconfig').read_text()
    for flag in ('CONFIG_ESPTOOLPY_FLASHSIZE_16MB=y','CONFIG_SPIRAM_MODE_OCT=y','CONFIG_LV_COLOR_16_SWAP=y'):
        if flag not in config: raise ValueError('Wrong board profile: '+flag)
    flash=json.loads((build/'flasher_args.json').read_text())
    expected={'0x0':'bootloader/bootloader.bin','0x8000':'partition_table/partition-table.bin','0x10000':'airbridge_native.bin'}
    if flash.get('flash_files')!=expected or flash.get('flash_settings')!={'flash_mode':'dio','flash_size':'16MB','flash_freq':'80m'}:
        raise ValueError('Unexpected flash layout or parameters')
    for offset,name in expected.items():
        data=(build/name).read_bytes()
        limits={'bootloader/bootloader.bin':0x8000,'partition_table/partition-table.bin':0x1000,'airbridge_native.bin':0x200000}
        if not data or len(data)>limits[name] or (name.endswith('airbridge_native.bin') and data[0]!=0xe9):raise ValueError('Invalid or oversized firmware segment')
        end=(int(offset,0)+len(data)+4095)//4096*4096
        if not (end<=0x9000 or int(offset,0)>=0xf000):raise ValueError('A firmware erase sector overlaps NVS')
    return expected


def authorize(port,identity):
    if not re.fullmatch(r'(?:[a-fA-F0-9]{2}:){5}[a-fA-F0-9]{2}',identity):raise ValueError('Expected a factory MAC serial')
    candidates=[item for item in list_ports.comports() if item.device==port]
    if len(candidates)!=1 or candidates[0].vid!=0x303a or candidates[0].pid!=0x1001 or (candidates[0].serial_number or '').upper()!=identity.upper():
        raise ValueError('Selected native USB port does not match the explicit hardware identity')


def flash_round(build,port,identity,evidence):
    files=inspect_build(build);authorize(port,identity)
    evidence.mkdir(parents=True,exist_ok=False)
    def run(arguments,after):
        authorize(port,identity)
        with (evidence/'esptool.log').open('a',encoding='utf8') as log:
            result=subprocess.run([sys.executable,'-m','esptool','--chip','esp32s3','--port',port,'--baud','460800','--after',after,*arguments],stdout=log,stderr=subprocess.STDOUT)
        if result.returncode:raise RuntimeError('Serial operation failed; keep backup and inspect '+str(evidence/'esptool.log'))
    before=evidence/'nvs-before.bin'
    run(['read-flash','0x9000','0x6000',str(before)],'no-reset')
    arguments=['write-flash','--flash-mode','dio','--flash-size','16MB','--flash-freq','80m']
    for offset,name in files.items():arguments.extend([offset,str(build/name)])
    run(arguments,'no-reset')
    count=max(int(offset,0)+(build/name).stat().st_size for offset,name in files.items())
    readback=evidence/'readback.bin';run(['read-flash','0',str(count),str(readback)],'hard-reset')
    raw=readback.read_bytes();records={}
    for offset,name in files.items():
        data=(build/name).read_bytes();actual=raw[int(offset,0):int(offset,0)+len(data)]
        if actual!=data:raise RuntimeError('Independent flash readback mismatch: '+name)
        records[name]={'bytes':len(data),'sha256':hashlib.sha256(actual).hexdigest(),'offset':offset}
    if raw[0x9000:0xf000]!=before.read_bytes():raise RuntimeError('NVS changed during programming; retain evidence and stop')
    result={'port':port,'usb_serial':identity,'segments':records,'nvs_preserved':True,'nvs_bytes':24576,'native_airdrop_tested':False}
    (evidence/'verification.json').write_text(json.dumps(result,indent=2)+'\n')
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build',type=Path,required=True)
    parser.add_argument('--port',required=True)
    parser.add_argument('--serial',required=True)
    parser.add_argument('--evidence',type=Path,required=True,help='New private backup/evidence directory; never commit')
    parser.add_argument('--yes',action='store_true')
    args=parser.parse_args()
    inspect_build(args.build);authorize(args.port,args.serial)
    if not args.yes and input('Replace application on '+args.port+'? Type FLASH: ')!='FLASH':raise SystemExit('Cancelled; no port opened')
    print(json.dumps(flash_round(args.build.resolve(),args.port,args.serial,args.evidence.resolve()),indent=2))
