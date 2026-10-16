"""Select the SDK-supported calibration mode in a generated local sdkconfig."""
# Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
from pathlib import Path
import re
import sys

path=Path(sys.argv[1])
if path.exists():
    config=path.read_text(encoding='utf-8')
    full=sys.argv[2]=='full'
    for key, enabled in [('CONFIG_ESP_PHY_RF_CAL_PARTIAL',not full),('CONFIG_ESP_PHY_RF_CAL_FULL',full),('CONFIG_ESP_PHY_RF_CAL_NONE',False)]:
        value=key+'=y' if enabled else '# '+key+' is not set'
        pattern=r'(?m)^(?:'+re.escape(key)+r'=.*|# '+re.escape(key)+r' is not set)$'
        config,n=re.subn(pattern,value,config)
        if not n: config+='\n'+value+'\n'
    path.write_text(config,encoding='utf-8')
elif sys.argv[2]=='full':
    raise RuntimeError('Build the default SDK configuration first, then select full calibration')
