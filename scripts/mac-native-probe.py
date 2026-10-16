"""Read-only AWDL TLS diagnostic. This does not qualify Finder file transfer."""
# Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
import argparse
import http.client
import ipaddress
import json
import plistlib
import socket
import ssl

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source',required=True)
parser.add_argument('--target',required=True)
args=parser.parse_args()
if not ipaddress.IPv6Address(args.source).is_link_local or not ipaddress.IPv6Address(args.target).is_link_local:
    raise ValueError('Both endpoints must be AWDL link-local addresses')
index=socket.if_nametoindex('awdl0')
raw=socket.socket(socket.AF_INET6,socket.SOCK_STREAM)
raw.settimeout(15)
raw.setsockopt(socket.SOL_SOCKET,0x1104,1)  # SO_RECV_ANYIF
raw.setsockopt(socket.SOL_SOCKET,0x1113,1)  # SO_AWDL_UNRESTRICTED
raw.bind((args.source,0,0,index))
raw.connect((args.target,8770,0,index))
context=ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
context.check_hostname=False
context.verify_mode=ssl.CERT_NONE  # Everyone-mode self-signed AirDrop identity
context.minimum_version=ssl.TLSVersion.TLSv1_2
context.maximum_version=ssl.TLSVersion.TLSv1_2
with context.wrap_socket(raw) as connection:
    body=plistlib.dumps({'DeviceSupportFlags':111611},fmt=plistlib.FMT_BINARY)
    request=('POST /Discover HTTP/1.1\r\nUser-Agent: AirBridgeProtocolProbe/1\r\nContent-Type: application/octet-stream\r\nContent-Length: '+str(len(body))+'\r\nConnection: close\r\n\r\n').encode()+body
    connection.sendall(request)
    response=http.client.HTTPResponse(connection)
    response.begin()
    data=response.read(16385)
    if response.status!=200 or len(data)>16384:
        raise RuntimeError('Unexpected native service response')
    identity=plistlib.loads(data)
    print(json.dumps(dict(event='diagnostic_discover',status=response.status,tls=connection.version(),source=connection.getsockname(),target=connection.getpeername(),identity=identity,native_file_verified=False),ensure_ascii=True))
