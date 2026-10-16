// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#include "awdl.hpp"
#include <algorithm>
#include <cstring>

namespace airbridge::awdl {
namespace {
unsigned le16(const std::uint8_t* p) {return unsigned(p[0]) | unsigned(p[1])<<8;}
unsigned be16(const std::uint8_t* p) {return unsigned(p[1]) | unsigned(p[0])<<8;}
// AWDL service TLVs use a fixed dictionary; these are not DNS packet offsets.
Error name(Bytes input,std::array<char,256>& output) {
    std::size_t cursor=0,used=0;
    auto append=[&](const char* p,std::size_t count) {
        if(!count) return true;
        if(count+used+(used ? 1 : 0)>=output.size()) return false;
        if(used) output[used++]='.';
        for(std::size_t i=0;i<count;i++) {
            auto c=static_cast<unsigned char>(p[i]);
            if(c<32 || c==127) return false;
            output[used++]=char(c>='A' && c<='Z' ? c+32 : c);
        }
        return true;
    };
    while(cursor<input.size) {
        const unsigned tag=input.data[cursor++];
        if(!tag) return cursor==input.size ? Error::none : Error::malformed;
        if(tag==0xc0) {
            if(cursor==input.size) return Error::truncated;
            const unsigned code=input.data[cursor++];
            const char* suffix=nullptr;
            switch(code) {
            case 0: suffix="";break;
            case 7: suffix="_airdrop._tcp.local";break;
            case 10: suffix="_tcp.local";break;
            case 11: suffix="_udp.local";break;
            case 12: suffix="local";break;
            default: return Error::unsupported;
            }
            if(!append(suffix,std::strlen(suffix))) return Error::malformed;
            return cursor==input.size ? Error::none : Error::malformed;
        }
        if(tag>63 || tag>input.size-cursor) return Error::truncated;
        if(!append(reinterpret_cast<const char*>(input.data+cursor),tag)) return Error::malformed;
        cursor+=tag;
    }
    return Error::truncated;
}
bool instance(const std::array<char,256>& owner,std::array<char,64>& out) {
    constexpr const char* suffix="._airdrop._tcp.local";
    const std::size_t length=std::strlen(owner.data()),tail=std::strlen(suffix);
    if(length<=tail || length-tail>=out.size() || std::strcmp(owner.data()+length-tail,suffix)) return false;
    std::copy_n(owner.begin(),length-tail,out.begin());return true;
}
}

Error parse_service_record(Bytes value,ServiceOffer& output) {
    if(!value.data || value.size<8) return Error::truncated;
    const auto* p=value.data;
    const std::size_t name_and_type=le16(p);
    if(name_and_type<2 || name_and_type>value.size-2) return Error::malformed;
    const std::size_t type_at=1+name_and_type;
    if(value.size-type_at<5) return Error::truncated;
    std::array<char,256> owner{};
    auto result=name({p+2,name_and_type-1},owner);
    if(result!=Error::none) return result;
    const std::size_t data_length=le16(p+type_at+1),data_at=type_at+5;
    if(data_length!=value.size-data_at) return Error::malformed;
    ServiceOffer draft{};
    if(p[type_at]==12 && std::strcmp(owner.data(),"_airdrop._tcp.local")==0) {
        std::array<char,256> target{};result=name({p+data_at,data_length},target);
        if(result!=Error::none) return result;
        draft.airdrop=instance(target,draft.instance);
    } else if(p[type_at]==33 && instance(owner,draft.instance)) {
        if(data_length<7) return Error::truncated;
        draft.port=static_cast<std::uint16_t>(be16(p+data_at+4));
        if(!draft.port) return Error::malformed;
        std::array<char,256> target{};result=name({p+data_at+6,data_length-6},target);
        if(result!=Error::none) return result;
        draft.airdrop=true;
    } else if(p[type_at]==16 && instance(owner,draft.instance)) {
        // Validate every TXT string even when this layer doesn't interpret flags.
        std::size_t at=data_at;
        while(at<value.size) {
            const unsigned size=p[at++];
            if(size>value.size-at) return Error::truncated;
            at+=size;
        }
        draft.airdrop=true;
    }
    output=draft;return Error::none;
}
} // namespace airbridge::awdl
