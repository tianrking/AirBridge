// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#include "serial_protocol.hpp"
#include <cstring>
namespace airbridge::serial {
std::uint32_t crc32(awdl::Bytes input) {
    std::uint32_t result=0xffffffffu;
    for(std::size_t i=0;i<input.size;i++) {result^=input.data[i];for(unsigned bit=0;bit<8;bit++) result=result&1 ? (result>>1)^0xedb88320u : result>>1;}
    return result^0xffffffffu;
}
awdl::Error parse_command(awdl::Bytes line,Command& output) {
    using awdl::Error;
    if(!line.data || line.size<17) return Error::truncated;
    if(line.size>224) return Error::unsupported;
    std::size_t size=line.size;
    if(line.data[size-1]!='\n') return Error::truncated;
    --size;if(size && line.data[size-1]=='\r') --size;
    if(size<15 || std::memcmp(line.data,"AB2 ",4)) return Error::not_awdl;
    const auto star=size-9;if(star<=5 || line.data[star]!='*' || line.data[star-1]!=' ') return Error::malformed;
    std::uint32_t checksum=0;
    for(std::size_t i=star+1;i<size;i++) {const auto c=line.data[i];const unsigned digit=c>='0' && c<='9' ? c-'0' : c>='a' && c<='f' ? c-'a'+10 : c>='A' && c<='F' ? c-'A'+10 : 255;if(digit>15) return Error::malformed;checksum=(checksum<<4)|digit;}
    if(crc32({line.data+4,star-5})!=checksum) return Error::malformed;
    Command result{};result.checksum=checksum;std::size_t cursor=4;
    if(line.data[cursor]<'0' || line.data[cursor]>'9') return Error::malformed;
    while(cursor<star-1 && line.data[cursor]!=' ') {
        const auto c=line.data[cursor++];if(c<'0' || c>'9' || result.sequence>(0xffffffffu-unsigned(c-'0'))/10) return Error::malformed;
        result.sequence=result.sequence*10+unsigned(c-'0');
    }
    if(cursor==star-1 || line.data[cursor++]!=' ') return Error::malformed;
    const auto count=star-1-cursor;if(!count || count>=result.body.size()) return Error::unsupported;
    for(std::size_t i=0;i<count;i++) {const auto c=line.data[cursor+i];if(c<32 || c>126 || c=='*') return Error::malformed;result.body[i]=char(c);}
    output=result;return Error::none;
}
Replay ReplayGuard::check(const Command& command) const {
    if(!initialized_ || command.sequence>last_.sequence) return Replay::fresh;
    if(command.sequence==last_.sequence) return command.checksum==last_.checksum && command.body==last_.body ? Replay::repeat : Replay::conflict;
    return Replay::stale;
}
}
