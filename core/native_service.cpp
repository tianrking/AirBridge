// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#include "native_service.hpp"
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <string_view>
namespace airbridge::native {
namespace {
constexpr std::uint64_t limit=128u*1024*1024;
bool same(std::string_view left,std::string_view right) {
    if(left.size()!=right.size()) return false;
    for(std::size_t i=0;i<left.size();i++) {
        auto c=left[i];if(c>='A' && c<='Z') c=char(c+32);
        auto d=right[i];if(d>='A' && d<='Z') d=char(d+32);
        if(c!=d) return false;
    }
    return true;
}
void labels(const awdl::Mac& own,char* instance,char* host) {
    std::snprintf(instance,64,"%02x%02x%02x%02x%02x%02x",own[0],own[1],own[2],own[3],own[4],own[5]);
    std::snprintf(host,64,"airbridge-%s.local",instance);
}
struct DnsWriter {
    MdnsPacket result{};bool good{true};
    void byte(unsigned value) {if(result.size==result.bytes.size()) {good=false;return;}result.bytes[result.size++]=std::uint8_t(value);}
    void word(unsigned value) {byte(value>>8);byte(value);}
    void longword(unsigned value) {word(value>>16);word(value);}
    void name(const char* value) {
        const char* at=value;
        while(*at) {const char* end=std::strchr(at,'.');const auto count=end ? std::size_t(end-at) : std::strlen(at);
            if(!count || count>63) {good=false;return;}byte(unsigned(count));for(std::size_t i=0;i<count;i++) byte(static_cast<unsigned char>(at[i]));
            at+=count;if(*at=='.') ++at;
        }byte(0);
    }
    std::size_t record(const char* owner,unsigned type,bool unique) {name(owner);word(type);word(unique ? 0x8001 : 1);longword(120);const auto at=result.size;word(0);return at;}
    void end(std::size_t start) {if(!good || start+2>result.size) {good=false;return;}const auto length=result.size-start-2;result.bytes[start]=std::uint8_t(length>>8);result.bytes[start+1]=std::uint8_t(length);}
};
unsigned word(const std::uint8_t* p) {return unsigned(p[0])<<8|p[1];}
bool dns_name(Bytes packet,std::size_t& cursor,std::array<char,256>& name) {
    std::size_t at=cursor,used=0;bool jumped=false;unsigned hops=0;
    for(;;) {
        if(at>=packet.size || ++hops>128) return false;
        const auto size=packet.data[at++];
        if((size&0xc0)==0xc0) {
            if(at>=packet.size) return false;
            const auto target=(std::size_t(size&63)<<8)|packet.data[at++];
            if(target>=at-2) return false;
            if(!jumped) cursor=at;
            jumped=true;at=target;continue;
        }
        if(size&0xc0 || size>63) return false;
        if(!size) {if(!jumped) cursor=at;name[used]=0;return true;}
        if(size>packet.size-at || used+size+(used ? 1 : 0)>=name.size()) return false;
        if(used) name[used++]='.';
        for(unsigned i=0;i<size;i++) {const auto c=packet.data[at++];if(c<33 || c=='.') return false;name[used++]=char(c);}
    }
}
bool decimal(std::string_view value,std::uint64_t& result) {
    if(value.empty()) return false;
    std::uint64_t out=0;
    for(char c:value) {if(c<'0' || c>'9' || out>(limit-std::uint64_t(c-'0'))/10) return false;out=out*10+unsigned(c-'0');}
    result=out;return true;
}
template<std::size_t N> bool text(std::array<char,N>& out,std::string_view value) {
    if(value.empty() || value.size()>=N) return false;
    for(char c:value) if(static_cast<unsigned char>(c)<32 || c==127) return false;
    std::copy(value.begin(),value.end(),out.begin());return true;
}
}
Error mdns_announcement(const awdl::Mac& own,std::uint16_t port,std::uint16_t id,MdnsPacket& result) {
    if(!port) return Error::malformed;
    std::array<char,64> instance{},host{};labels(own,instance.data(),host.data());
    std::array<char,96> service{};std::snprintf(service.data(),service.size(),"%s._airdrop._tcp.local",instance.data());
    DnsWriter out;out.word(id);out.word(0x8400);out.word(0);out.word(4);out.word(0);out.word(0);
    auto record=out.record("_airdrop._tcp.local",12,false);out.name(service.data());out.end(record);
    record=out.record(service.data(),33,true);out.word(0);out.word(0);out.word(port);out.name(host.data());out.end(record);
    record=out.record(service.data(),16,true);constexpr const char flags[]="flags=137";out.byte(sizeof(flags)-1);for(unsigned i=0;i<sizeof(flags)-1;i++) out.byte(flags[i]);out.end(record);
    record=out.record(host.data(),28,true);for(auto byte:awdl::link_local(own)) out.byte(byte);out.end(record);
    if(!out.good) return Error::truncated;
    result=out.result;return Error::none;
}
bool mdns_question(Bytes packet,const awdl::Mac& own) {
    if(!packet.data || packet.size<12 || packet.size>1280 || (packet.data[2]&0x80)) return false;
    const auto count=word(packet.data+4);if(!count || count>32) return false;
    std::array<char,64> instance{},host{};labels(own,instance.data(),host.data());std::array<char,96> service{};
    std::snprintf(service.data(),service.size(),"%s._airdrop._tcp.local",instance.data());
    std::size_t cursor=12;bool relevant=false;
    for(unsigned i=0;i<count;i++) {
        std::array<char,256> name{};if(!dns_name(packet,cursor,name) || packet.size-cursor<4) return false;
        const auto type=word(packet.data+cursor),kind=word(packet.data+cursor+2)&0x7fff;cursor+=4;
        if(kind==1 && (type==12 || type==16 || type==28 || type==33 || type==255) &&
           (same(name.data(),"_airdrop._tcp.local") || same(name.data(),service.data()) || same(name.data(),host.data()))) relevant=true;
    }
    return relevant;
}
Error parse_request(Bytes headers,Request& result) {
    if(!headers.data || headers.size<4) return Error::truncated;
    if(headers.size>8192) return Error::unsupported;
    const std::string_view input(reinterpret_cast<const char*>(headers.data),headers.size);
    if(input.substr(input.size()-4)!="\r\n\r\n") return Error::truncated;
    const auto line=input.find("\r\n");if(line==std::string_view::npos) return Error::malformed;
    const auto first=input.substr(0,line);const auto space=first.find(' ',5);
    Request draft{};
    if(first.substr(0,5)!="POST " || space==std::string_view::npos || first.substr(space)!=" HTTP/1.1" || !text(draft.path,first.substr(5,space-5))) return Error::unsupported;
    std::size_t cursor=line+2;bool transfer=false,type=false,expect=false;
    while(cursor<input.size()-2) {
        const auto end=input.find("\r\n",cursor),colon=input.find(':',cursor);
        if(end==std::string_view::npos || colon==std::string_view::npos || colon==cursor || colon>=end) return Error::malformed;
        const auto key=input.substr(cursor,colon-cursor);auto value=input.substr(colon+1,end-colon-1);
        while(!value.empty() && (value.front()==' ' || value.front()=='\t')) value.remove_prefix(1);
        while(!value.empty() && (value.back()==' ' || value.back()=='\t')) value.remove_suffix(1);
        for(char c:key) if(c<=32 || c>=127) return Error::malformed;
        if(same(key,"content-length")) {if(draft.has_length || !decimal(value,draft.length)) return Error::malformed;draft.has_length=true;}
        else if(same(key,"transfer-encoding")) {if(draft.chunked || !same(value,"chunked")) return Error::malformed;draft.chunked=true;}
        else if(same(key,"content-type")) {if(type || !text(draft.content_type,value)) return Error::malformed;type=true;}
        else if(same(key,"transferid")) {if(transfer || !text(draft.transfer_id,value)) return Error::malformed;transfer=true;}
        else if(same(key,"totalbytes")) {if(draft.has_total || !decimal(value,draft.total_bytes)) return Error::malformed;draft.has_total=true;}
        else if(same(key,"expect")) {if(expect || !same(value,"100-continue")) return Error::unsupported;draft.expect_continue=true;expect=true;}
        cursor=end+2;
    }
    if(draft.chunked==draft.has_length) return Error::malformed;
    result=draft;return Error::none;
}
BodyDecoder::BodyDecoder(const Request& request,transfer::Emit emit,void* context):
    state_(request.chunked ? State::length : request.length ? State::data : State::done),chunked_(request.chunked),remaining_(request.length),emit_(emit),context_(context){}
bool BodyDecoder::complete() const {return state_==State::done;}
Error BodyDecoder::feed(Bytes input,std::size_t& consumed) {
    consumed=0;if(state_==State::failed || (!input.data && input.size)) return Error::malformed;
    auto fail=[&](){state_=State::failed;return Error::malformed;};
    while(consumed<input.size && state_!=State::done) {
        if(state_==State::data) {
            const auto count=std::min(std::uint64_t(input.size-consumed),remaining_);
            if(!count || total_+count>limit || !emit_ || !emit_(context_,{input.data+consumed,std::size_t(count)})) return fail();
            consumed+=std::size_t(count);remaining_-=count;total_+=count;
            if(!remaining_) state_=chunked_ ? State::cr : State::done;
        } else if(state_==State::cr || state_==State::lf) {
            if(input.data[consumed++]!=(state_==State::cr ? '\r' : '\n')) return fail();
            state_=state_==State::cr ? State::lf : State::length;
        } else {
            if(used_==line_.size()) return fail();
            const char c=char(input.data[consumed++]);line_[used_++]=c;
            if(c!='\n') continue;
            if(used_<2 || line_[used_-2]!='\r') return fail();
            const std::string_view line(line_.data(),used_-2);
            if(state_==State::trailers) {
                trailer_bytes_+=used_;if(trailer_bytes_>4096 || (!line.empty() && line.find(':')==std::string_view::npos)) return fail();
                if(line.empty()) state_=State::done;
            } else {
                const auto end=line.find(';');const auto digits=line.substr(0,end);
                if(digits.empty() || digits.size()>8) return fail();
                remaining_=0;
                for(char value:digits) {
                    const auto digit=value>='0' && value<='9' ? value-'0' : value>='a' && value<='f' ? value-'a'+10 : value>='A' && value<='F' ? value-'A'+10 : 255;
                    if(digit>15 || remaining_>(limit-unsigned(digit))/16) return fail();
                    remaining_=remaining_*16+unsigned(digit);
                }
                if(remaining_>limit-total_) return fail();
                state_=remaining_ ? State::data : State::trailers;
            }
            used_=0;
        }
    }
    return Error::none;
}
}
