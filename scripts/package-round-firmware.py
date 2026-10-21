"""Package the distinct round-display build; never replace the default v0.0.1 assets."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile
from release_common import archive, identity
import importlib.util
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('round_flash',ROOT/'scripts/flash-round.py')
flash=importlib.util.module_from_spec(spec);spec.loader.exec_module(flash)


def package(build,tag,commit,output):
    version=identity(ROOT,tag,commit);files=flash.inspect_build(build)
    contents={name:(build/name).read_bytes() for name in files.values()}
    contents['README.md']=(ROOT/'docs/round-display.md').read_text(encoding='utf8').replace('(../firmware/round/THIRD_PARTY.md)','(THIRD_PARTY.md)').encode('utf8')
    contents['assets/round-home.png']=(ROOT/'docs/assets/round-home.png').read_bytes()
    contents['round-display-verification.md']=(ROOT/'docs/round-display-verification.md').read_bytes()
    contents['LICENSE']=(ROOT/'LICENSE').read_bytes()
    contents['THIRD_PARTY.md']=(ROOT/'firmware/round/THIRD_PARTY.md').read_bytes()
    for component,license_name in [('lvgl','LICENCE.txt'),('st77916','LICENSE'),('cjson','LICENSE')]:
        contents['licenses/'+component+'.txt']=(ROOT/'firmware/round/components'/component/license_name).read_bytes()
    contents['BUILD.json']=(json.dumps({'version':version,'commit':commit,'variant':'round-display','board':'spotpear-s3-180-v1',
        'idf':'v6.1','flash_bytes':16777216,'psram_bytes':8388608,'display':'ST77916 QSPI 360x360','touch':'CST816S I2C',
        'flash_files':files,'hardware_qualified_by_ci':False,'no_nvs_included':True},indent=2)+'\n').encode()
    result=archive(output,'AirBridge-round-display-'+tag+'.zip','esp32s3-round-display',version,commit,contents)
    (output/'SHA256SUMS').write_text(hashlib.sha256(result.read_bytes()).hexdigest()+'  '+result.name+'\n')
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build',type=Path,required=True);parser.add_argument('--tag',required=True)
    parser.add_argument('--commit',required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();print(package(args.build,args.tag,args.commit,args.output))
