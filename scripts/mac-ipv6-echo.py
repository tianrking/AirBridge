"""Bounded AWDL-only diagnostic; never changes a Mac network interface."""
import argparse
import hashlib
import ipaddress
import json
import os
import re
import socket
import subprocess
import sys

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("--target",required=True)
args=parser.parse_args()
target=ipaddress.IPv6Address(args.target)
if sys.platform!="darwin" or not target.is_link_local:
    parser.error("requires macOS and a literal link-local IPv6 target")
scope=socket.if_nametoindex("awdl0")
state=subprocess.check_output(["/sbin/ifconfig","awdl0"],text=True)
match=re.search(r"inet6 (fe80:[0-9a-f:]+)%awdl0",state,re.I)
if not match:
    raise SystemExit("No AWDL link-local source address")
source=match.group(1)
for attempt in range(3):
    payload=b"AirBridge independent IPv6 diagnostic:"+os.urandom(32)
    try:
        with socket.socket(socket.AF_INET6,socket.SOCK_DGRAM) as link:
            # Numeric constants verified against Apple's bsd/sys/socket_private.h.
            link.setsockopt(socket.SOL_SOCKET,0x1104,1) # SO_RECV_ANYIF
            link.setsockopt(socket.SOL_SOCKET,0x1113,1) # SO_AWDL_UNRESTRICTED
            link.settimeout(5)
            link.bind((source,0,0,scope))
            link.sendto(payload,(str(target),8779,0,scope))
            returned,peer=link.recvfrom(512)
            if returned!=payload or ipaddress.IPv6Address(peer[0].split("%")[0])!=target or peer[3]!=scope:
                raise RuntimeError("payload or AWDL peer mismatch")
            print(json.dumps(dict(event="awdl_ipv6_echo_pass",bytes=len(payload),sha256=hashlib.sha256(payload).hexdigest(),interface="awdl0",attempt=attempt+1)),flush=True)
            break
    except (OSError,RuntimeError) as error:
        print(json.dumps(dict(event="awdl_ipv6_echo_failed",attempt=attempt+1,error=str(error))),flush=True)
else:
    raise SystemExit(2)
