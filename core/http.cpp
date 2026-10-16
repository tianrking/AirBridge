// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#include "discover.hpp"
#include <cstring>
namespace airbridge::discovery {
using awdl::Error;
namespace {
constexpr std::size_t absent=static_cast<std::size_t>(-1);
std::size_t line_end(const std::uint8_t* p,std::size_t at,std::size_t size) {
    for(std::size_t i=at;i+1<size;i++) if(p[i]=='\r' && p[i+1]=='\n') return i;
    return absent;
}
bool equals(const std::uint8_t* p,std::size_t size,const char* expected) {
    if(size!=std::strlen(expected)) return false;
    for(std::size_t i=0;i<size;i++) {
        const auto c=p[i];if(unsigned(c>='A' && c<='Z' ? c+32 : c)!=unsigned(static_cast<unsigned char>(expected[i]))) return false;
    }
    return true;
}
struct Chunk {std::size_t at{},size{};};
}
Error parse_http_response(std::uint8_t* wire,std::size_t size,HttpResponse& output,bool eof) {
    if(!wire || size<12) return Error::truncated;
    if(std::memcmp(wire,"HTTP/1.",7) || (wire[7]!='0' && wire[7]!='1') || wire[8]!=' ') return Error::malformed;
    unsigned status=0;
    for(unsigned i=9;i<12;i++) {if(wire[i]<'0' || wire[i]>'9') return Error::malformed;status=status*10+wire[i]-'0';}
    if(status<100 || status>599) return Error::malformed;
    auto at=line_end(wire,0,size);if(at==absent) return Error::truncated;
    at+=2;bool chunked=false,have_length=false;std::size_t length=0;
    for(;;) {
        if(at>4096) return Error::unsupported;
        const auto end=line_end(wire,at,size);if(end==absent) return Error::truncated;
        if(end==at) {at+=2;break;}
        std::size_t colon=at;while(colon<end && wire[colon]!=':') ++colon;
        if(colon==at || colon==end) return Error::malformed;
        std::size_t value=colon+1,last=end;
        while(value<last && (wire[value]==' ' || wire[value]=='\t')) ++value;
        while(last>value && (wire[last-1]==' ' || wire[last-1]=='\t')) --last;
        if(equals(wire+at,colon-at,"content-length")) {
            if(have_length || value==last) return Error::malformed;
            have_length=true;
            for(auto i=value;i<last;i++) {
                if(wire[i]<'0' || wire[i]>'9') return Error::malformed;
                length=length*10+wire[i]-'0';if(length>16384) return Error::unsupported;
            }
        } else if(equals(wire+at,colon-at,"transfer-encoding")) {
            if(chunked || !equals(wire+value,last-value,"chunked")) return Error::unsupported;
            chunked=true;
        }
        at=end+2;
    }
    const auto body=at;
    if(chunked && have_length) return Error::malformed;
    if(!chunked) {
        if(!have_length) {if(!eof) return Error::truncated;length=size-body;}
        if(length>16384) return Error::unsupported;
        if(length>size-body) return Error::truncated;
        if(length!=size-body) return Error::malformed;
        output={status,{wire+body,length}};return Error::none;
    }
    std::array<Chunk,128> chunks{};std::size_t used=0,total=0;
    for(;;) {
        const auto end=line_end(wire,at,size);if(end==absent) return Error::truncated;
        if(end-at>64 || end==at) return Error::malformed;
        std::size_t chunk=0;bool digits=false,extension=false;
        for(auto i=at;i<end;i++) {
            if(wire[i]==';') {extension=true;break;}
            unsigned value=wire[i];
            if(value>='0' && value<='9') value-='0';
            else if(value>='a' && value<='f') value=value-'a'+10;
            else if(value>='A' && value<='F') value=value-'A'+10;
            else return Error::malformed;
            digits=true;chunk=chunk*16+value;if(chunk>16384) return Error::unsupported;
        }
        if(!digits) return Error::malformed;
        (void)extension;at=end+2;
        if(!chunk) {
            for(;;) {
                const auto trailer=line_end(wire,at,size);if(trailer==absent) return Error::truncated;
                if(trailer-at>1024) return Error::unsupported;
                if(trailer==at) {at+=2;break;}
                at=trailer+2;
            }
            if(at!=size) return Error::malformed;
            break;
        }
        if(chunk>size-at || size-at-chunk<2) return Error::truncated;
        if(wire[at+chunk]!='\r' || wire[at+chunk+1]!='\n') return Error::malformed;
        if(used==chunks.size() || chunk>16384-total) return Error::unsupported;
        chunks[used++]={at,chunk};total+=chunk;at+=chunk+2;
    }
    // The validation pass leaves partial input untouched. Commit only at the end.
    std::size_t destination=body;
    for(std::size_t i=0;i<used;i++) {std::memmove(wire+destination,wire+chunks[i].at,chunks[i].size);destination+=chunks[i].size;}
    output={status,{wire+body,total}};return Error::none;
}
} // namespace airbridge::discovery
