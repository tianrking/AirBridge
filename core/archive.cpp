// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#include "archive.hpp"
#include <algorithm>
#include <cstdio>
#include <cstring>
namespace airbridge::transfer {
namespace {
constexpr std::uint64_t maximum=64u*1024*1024;
bool number(const char* data,std::size_t count,unsigned radix,std::uint32_t& result) {
    std::uint64_t value=0;
    for(std::size_t i=0;i<count;i++) {
        const unsigned char c=static_cast<unsigned char>(data[i]);
        const unsigned digit=c>='0' && c<='9' ? c-'0' : c>='a' && c<='f' ? c-'a'+10 : c>='A' && c<='F' ? c-'A'+10 : 255;
        if(digit>=radix) return false;
        value=value*radix+digit;if(value>0xffffffffu) return false;
    }
    result=std::uint32_t(value);return true;
}
}
bool safe_filename(const char* value) {
    if(!value || !*value) return false;
    const std::size_t length=std::strlen(value);
    if(length>240 || value[length-1]==' ' || value[length-1]=='.' || !std::strcmp(value,".") || !std::strcmp(value,"..")) return false;
    for(const unsigned char* p=reinterpret_cast<const unsigned char*>(value);*p;p++)
        if(*p<32 || std::strchr("/\\:<>\"|?*",*p)) return false;
    std::array<char,8> stem{};std::size_t n=0;
    while(value[n] && value[n]!='.' && n+1<stem.size()) {
        const auto c=value[n];stem[n]=char(c>='a' && c<='z' ? c-32 : c);++n;
    }
    if(!std::strcmp(stem.data(),"CON") || !std::strcmp(stem.data(),"PRN") || !std::strcmp(stem.data(),"AUX") ||
       !std::strcmp(stem.data(),"NUL") || (n==4 && (!std::memcmp(stem.data(),"COM",3) || !std::memcmp(stem.data(),"LPT",3)) && stem[3]>='1' && stem[3]<='9')) return false;
    return true;
}
Error CpioReader::decode_header() {
    std::uint32_t names=0;
    if(modern_) {
        if(!number(header_.data()+14,8,16,mode_) || !number(header_.data()+54,8,16,size_) ||
           !number(header_.data()+94,8,16,names)) return Error::malformed;
    } else if(!number(header_.data()+18,6,8,mode_) || !number(header_.data()+59,6,8,names) ||
              !number(header_.data()+65,11,8,size_)) return Error::malformed;
    if(!names || names>name_.size() || size_>maximum) return Error::malformed;
    need_=names;have_=0;name_.fill(0);state_=State::name;return Error::none;
}
Error CpioReader::begin_entry() {
    if(name_[need_-1]!=0 || std::memchr(name_.data(),0,need_-1)) return Error::malformed;
    padding_=modern_ ? (4-((110+need_)%4))%4 : 0;
    if(!std::strcmp(name_.data(),"TRAILER!!!")) {
        if(size_) return Error::malformed;
        regular_=false;state_=padding_ ? State::name_padding : State::done;return Error::none;
    }
    const char* basename=name_.data();
    if(basename[0]=='.' && basename[1]=='/') basename+=2;
    const auto kind=mode_&0170000;
    if(kind==0040000) {
        if(size_ || (std::strcmp(basename,".") && !safe_filename(basename))) return Error::unsupported;
        regular_=false;
    } else {
        if(kind!=0100000 || !safe_filename(basename) || files_==seen_.size() || total_+size_>maximum) return Error::unsupported;
        for(unsigned i=0;i<files_;i++) if(!std::strcmp(seen_[i].data(),basename)) return Error::duplicate;
        std::snprintf(seen_[files_].data(),seen_[files_].size(),"%s",basename);
        if(!sink_.begin || !sink_.begin(sink_.context,basename,size_)) return Error::malformed;
        ++files_;total_+=size_;regular_=true;
    }
    remaining_=size_;state_=padding_ ? State::name_padding : State::data;
    if(!padding_ && !remaining_) return complete_entry();
    return Error::none;
}
Error CpioReader::complete_entry() {
    if(regular_ && (!sink_.end || !sink_.end(sink_.context))) return Error::malformed;
    padding_=modern_ ? (4-(size_%4))%4 : 0;
    state_=padding_ ? State::data_padding : State::header;have_=0;need_=6;return Error::none;
}
Error CpioReader::feed(Bytes input) {
    if(state_==State::failed || (!input.data && input.size)) return Error::malformed;
    std::size_t cursor=0;
    auto fail=[&](Error error){state_=State::failed;return error;};
    while(cursor<input.size) {
        if(state_==State::done) {
            // Archive writers may pad to a record boundary; only zero bytes are allowed.
            if(input.data[cursor++]) return fail(Error::malformed);
            continue;
        }
        if(state_==State::header || state_==State::name) {
            const bool header=state_==State::header;
            const auto count=std::min(need_-have_,input.size-cursor);
            std::memcpy((header ? header_.data() : name_.data())+have_,input.data+cursor,count);
            have_+=count;cursor+=count;
            if(have_<need_) continue;
            if(header && need_==6) {
                modern_=!std::memcmp(header_.data(),"070701",6);
                if(!modern_ && std::memcmp(header_.data(),"070707",6)) return fail(Error::unsupported);
                need_=modern_ ? 110 : 76;continue;
            }
            const auto error=header ? decode_header() : begin_entry();
            if(error!=Error::none) return fail(error);
            continue;
        }
        if(state_==State::name_padding || state_==State::data_padding) {
            const auto count=std::min(padding_,input.size-cursor);cursor+=count;padding_-=count;
            if(padding_) continue;
            if(state_==State::data_padding) {state_=State::header;have_=0;need_=6;}
            else if(!std::strcmp(name_.data(),"TRAILER!!!")) state_=State::done;
            else {state_=State::data;if(!remaining_) {const auto error=complete_entry();if(error!=Error::none) return fail(error);}}
            continue;
        }
        const auto count=std::min(std::size_t(remaining_),input.size-cursor);
        if(regular_ && (!sink_.write || !sink_.write(sink_.context,{input.data+cursor,count}))) return fail(Error::malformed);
        cursor+=count;remaining_-=std::uint32_t(count);
        if(!remaining_) {const auto error=complete_entry();if(error!=Error::none) return fail(error);}
    }
    return Error::none;
}
Error CpioReader::finish() const {return state_==State::done ? Error::none : state_==State::failed ? Error::malformed : Error::truncated;}
Error DvZipReader::feed(Bytes input) {
    if(failed_ || (!input.data && input.size)) return Error::malformed;
    std::size_t cursor=0;
    auto fail=[&](Error error){failed_=true;return error;};
    while(cursor<input.size) {
        if(have_<4) {
            header_[have_++]=input.data[cursor++];
            if(have_<4) continue;
            const std::uint32_t raw=(std::uint32_t(header_[0])<<24)|(std::uint32_t(header_[1])<<16)|(std::uint32_t(header_[2])<<8)|header_[3];
            stored_=bool(raw&0x80000000u);length_=raw&0x7fffffffu;used_=0;
            if(!length_ || length_>capacity_ || length_>263168 || (stored_ && length_>262144) || !compressed_) return fail(Error::malformed);
        }
        const auto count=std::min(length_-used_,input.size-cursor);
        std::memcpy(compressed_+used_,input.data+cursor,count);used_+=count;cursor+=count;
        if(used_<length_) continue;
        Bytes decoded{compressed_,length_};std::size_t expanded=0;
        if(!stored_) {
            if(!expanded_ || !expanded_capacity_ || expanded_capacity_>262144 || !inflate_ || !inflate_(context_,decoded,expanded_,expanded_capacity_,expanded) || !expanded || expanded>expanded_capacity_) return fail(Error::malformed);
            decoded={expanded_,expanded};
        }
        const auto error=archive_.feed(decoded);if(error!=Error::none) return fail(error);
        have_=length_=used_=0;
    }
    return Error::none;
}
Error DvZipReader::finish() const {
    if(failed_) return Error::malformed;
    return have_ || length_ ? Error::truncated : archive_.finish();
}
Error write_cpio_header(const char* filename,std::uint32_t size,Emit emit,void* context) {
    if(!safe_filename(filename) || size>maximum || !emit) return Error::malformed;
    std::array<char,80> header{};
    const auto names=unsigned(std::strlen(filename)+3); // ./name plus NUL
    const int length=std::snprintf(header.data(),header.size(),"070707%06o%06o%06o%06o%06o%06o%06o%011o%06o%011o",0,1,0100644,0,0,1,0,0,names,unsigned(size));
    if(length!=76 || !emit(context,{reinterpret_cast<const std::uint8_t*>(header.data()),76}) ||
       !emit(context,{reinterpret_cast<const std::uint8_t*>("./"),2}) ||
       !emit(context,{reinterpret_cast<const std::uint8_t*>(filename),names-2})) return Error::malformed;
    return Error::none;
}
Error write_cpio_trailer(Emit emit,void* context) {
    std::array<char,80> header{};
    const int length=std::snprintf(header.data(),header.size(),"070707%06o%06o%06o%06o%06o%06o%06o%011o%06o%011o",0,0,0,0,0,1,0,0,11,0);
    return length==76 && emit && emit(context,{reinterpret_cast<const std::uint8_t*>(header.data()),76}) &&
        emit(context,{reinterpret_cast<const std::uint8_t*>("TRAILER!!!"),11}) ? Error::none : Error::malformed;
}
Error write_dvzip_stored(Bytes bytes,Emit emit,void* context) {
    if(!emit || (!bytes.data && bytes.size)) return Error::malformed;
    std::size_t cursor=0;
    while(cursor<bytes.size) {
        const auto count=std::min(std::size_t{65536},bytes.size-cursor);const auto size=std::uint32_t(count)|0x80000000u;
        const std::array<std::uint8_t,4> header{std::uint8_t(size>>24),std::uint8_t(size>>16),std::uint8_t(size>>8),std::uint8_t(size)};
        if(!emit(context,{header.data(),header.size()}) || !emit(context,{bytes.data+cursor,count})) return Error::malformed;
        cursor+=count;
    }
    return Error::none;
}
}
