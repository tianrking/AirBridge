// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#include "discover.hpp"
#include "native_service.hpp"
#include <algorithm>
#include <cstring>

namespace airbridge::discovery {
using awdl::Error;
namespace {
std::uint64_t big(const std::uint8_t* p,unsigned bytes) {
    std::uint64_t value=0;for(unsigned i=0;i<bytes;i++) value=value<<8|p[i];return value;
}
struct Reader {
    const std::uint8_t* data;std::size_t table;unsigned offsets,refs;std::uint64_t count;
    bool object(std::uint64_t id,std::size_t& at) const {
        if(id>=count) return false;
        const auto offset=big(data+table+std::size_t(id)*offsets,offsets);
        if(offset<8 || offset>=table) return false;
        at=std::size_t(offset);return true;
    }
    bool length(std::size_t& at,std::uint64_t& length) const {
        if(at>=table) return false;
        length=data[at++]&15;
        if(length!=15) return true;
        if(at>=table || (data[at]&0xf0)!=0x10 || (data[at]&15)>3) return false;
        const unsigned bytes=1u<<(data[at++]&15);
        if(bytes>table-at) return false;
        length=big(data+at,bytes);at+=bytes;return length<=4096;
    }
    bool string(std::uint64_t id,char* output,std::size_t capacity) const {
        std::size_t at=0;if(!object(id,at)) return false;
        const auto kind=data[at]&0xf0;
        if(kind!=0x50 && kind!=0x60) return false;
        std::uint64_t units_count=0;if(!length(at,units_count)) return false;
        const auto units=kind==0x60 ? 2u : 1u;
        if(units_count>(table-at)/units) return false;
        std::size_t used=0;
        auto byte=[&](unsigned value) {
            if(!value || used+1>=capacity) return false;
            output[used++]=char(value);return true;
        };
        for(std::uint64_t i=0;i<units_count;i++) {
            auto c=unsigned(big(data+at+std::size_t(i)*units,units));
            if(kind==0x50) {if(c>=128 || !byte(c)) return false;continue;}
            if(c>=0xd800 && c<=0xdbff) {
                if(++i==units_count) return false;
                const auto low=unsigned(big(data+at+std::size_t(i)*2,2));
                if(low<0xdc00 || low>0xdfff) return false;
                c=0x10000+(c-0xd800)*1024+low-0xdc00;
            } else if(c>=0xdc00 && c<=0xdfff) return false;
            if(c<128) {if(!byte(c)) return false;}
            else if(c<2048) {if(!byte(0xc0|(c>>6)) || !byte(0x80|(c&63))) return false;}
            else if(c<65536) {if(!byte(0xe0|(c>>12)) || !byte(0x80|((c>>6)&63)) || !byte(0x80|(c&63))) return false;}
            else if(!byte(0xf0|(c>>18)) || !byte(0x80|((c>>12)&63)) || !byte(0x80|((c>>6)&63)) || !byte(0x80|(c&63))) return false;
        }
        output[used]=0;return true;
    }
    bool lookup(std::uint64_t id,const char* key,std::uint64_t& result,bool& present) const {
        std::size_t at=0;std::uint64_t fields=0;present=false;
        if(!object(id,at) || (data[at]&0xf0)!=0xd0 || !length(at,fields) || fields>(table-at)/(2*refs)) return false;
        for(std::uint64_t i=0;i<fields;i++) {
            std::array<char,256> name{};
            if(!string(big(data+at+std::size_t(i)*refs,refs),name.data(),name.size())) return false;
            if(std::strcmp(key,name.data())) continue;
            if(present) return false;
            present=true;result=big(data+at+std::size_t(fields+i)*refs,refs);
            if(result>=count) return false;
        }
        return true;
    }
    bool integer(std::uint64_t id,std::uint32_t& result) const {
        std::size_t at=0;if(!object(id,at) || (data[at]&0xf0)!=0x10 || (data[at]&15)>3) return false;
        const unsigned bytes=1u<<(data[at++]&15);if(bytes>table-at) return false;
        const auto value=big(data+at,bytes);if(value>0xffffffffu) return false;result=std::uint32_t(value);return true;
    }
};
}

Error parse_identity_plist(awdl::Bytes body,Identity& output) {
    if(!body.data || body.size<40) return Error::truncated;
    if(std::memcmp(body.data,"bplist00",8)) return Error::unsupported;
    const auto* trailer=body.data+body.size-32;
    const unsigned offsets=trailer[6],refs=trailer[7];
    const auto count=big(trailer+8,8),root=big(trailer+16,8),table=big(trailer+24,8);
    if(!offsets || offsets>8 || !refs || refs>8 || !count || count>4096 || root>=count ||
       table<8 || table>body.size-32 || count>(body.size-32-table)/offsets) return Error::malformed;
    Reader reader{body.data,std::size_t(table),offsets,refs,count};
    std::size_t at=0;if(!reader.object(root,at) || (body.data[at]&0xf0)!=0xd0) return Error::malformed;
    std::uint64_t fields=0;if(!reader.length(at,fields) || fields>4096 || fields>(reader.table-at)/(2*refs)) return Error::malformed;
    Identity draft{};bool has_name=false,has_model=false;
    for(std::uint64_t i=0;i<fields;i++) {
        std::array<char,256> key{};
        const auto key_id=big(body.data+at+std::size_t(i)*refs,refs);
        const auto value_id=big(body.data+at+std::size_t(fields+i)*refs,refs);
        if(!reader.string(key_id,key.data(),key.size())) return Error::malformed;
        if(std::strcmp(key.data(),"ReceiverComputerName")==0) {
            if(has_name || !reader.string(value_id,draft.name.data(),draft.name.size())) return Error::malformed;
            has_name=true;
        } else if(std::strcmp(key.data(),"ReceiverModelName")==0) {
            if(has_model || !reader.string(value_id,draft.model.data(),draft.model.size())) return Error::malformed;
            has_model=true;
        } else if(std::strcmp(key.data(),"IsAirDropable")==0) {
            std::size_t object=0;
            if(draft.has_airdropable || !reader.object(value_id,object) || (body.data[object]!=8 && body.data[object]!=9)) return Error::malformed;
            draft.has_airdropable=true;draft.airdropable=body.data[object]==9;
        }
    }
    output=draft;return Error::none;
}

std::array<std::uint8_t,72> discover_request(std::uint32_t support_flags) {
    std::array<std::uint8_t,72> output{};
    std::memcpy(output.data(),"bplist00",8);
    output[8]=0xd1;output[9]=1;output[10]=2;output[11]=0x5f;output[12]=0x10;output[13]=18;
    std::memcpy(output.data()+14,"DeviceSupportFlags",18);
    output[32]=0x12;
    for(unsigned i=0;i<4;i++) output[33+i]=std::uint8_t(support_flags>>(24-i*8));
    output[37]=8;output[38]=11;output[39]=32;output[46]=output[47]=1;output[55]=3;output[71]=37;
    return output;
}
} // namespace airbridge::discovery

namespace airbridge::native {
Error parse_ask(Bytes body,AskManifest& output) {
    using namespace discovery;
    if(!body.data || body.size<40) return Error::truncated;
    if(std::memcmp(body.data,"bplist00",8)) return Error::unsupported;
    const auto* trailer=body.data+body.size-32;const unsigned offsets=trailer[6],refs=trailer[7];
    const auto count=big(trailer+8,8),root=big(trailer+16,8),table=big(trailer+24,8);
    if(!offsets || offsets>8 || !refs || refs>8 || !count || count>4096 || root>=count || table<8 || table>body.size-32 || count>(body.size-32-table)/offsets) return Error::malformed;
    Reader reader{body.data,std::size_t(table),offsets,refs,count};AskManifest result{};
    std::uint64_t value=0,id=0;bool found=false;
    if(!reader.lookup(root,"TransferID",value,found) || !found || !reader.lookup(value,"id",id,found) || !found ||
       !reader.string(id,result.transfer_id.data(),result.transfer_id.size())) return Error::malformed;
    for(char c:result.transfer_id) {
        if(!c) break;
        if(!((c>='0' && c<='9') || (c>='a' && c<='z') || (c>='A' && c<='Z') || c=='-')) return Error::malformed;
    }
    if(!*result.transfer_id.data()) return Error::malformed;
    if(!reader.lookup(root,"SenderComputerName",value,found) || (found && !reader.string(value,result.sender.data(),result.sender.size()))) return Error::malformed;
    if(!reader.lookup(root,"Files",value,found) || !found) return Error::unsupported;
    std::size_t at=0;std::uint64_t entries=0;
    if(!reader.object(value,at) || (body.data[at]&0xf0)!=0xa0 || !reader.length(at,entries) || !entries || entries>result.files.size() || entries>(reader.table-at)/refs) return Error::unsupported;
    for(std::uint64_t i=0;i<entries;i++) {
        const auto entry=big(body.data+at+std::size_t(i)*refs,refs);auto& file=result.files[std::size_t(i)];
        if(!reader.lookup(entry,"FileName",value,found) || !found || !reader.string(value,file.name.data(),file.name.size()) ||
           !transfer::safe_filename(file.name.data()) || !reader.lookup(entry,"FileSize",value,found) || !found || !reader.integer(value,file.size)) return Error::malformed;
        if(!reader.lookup(entry,"FileIsDirectory",value,found)) return Error::malformed;
        if(found) {std::size_t flag=0;if(!reader.object(value,flag) || body.data[flag]!=8) return Error::unsupported;}
        for(std::uint64_t prior=0;prior<i;prior++) if(!std::strcmp(result.files[std::size_t(prior)].name.data(),file.name.data())) return Error::duplicate;
        result.total+=file.size;if(result.total>64u*1024*1024) return Error::unsupported;
    }
    result.count=unsigned(entries);output=result;return Error::none;
}
}
