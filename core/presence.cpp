// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#include "presence.hpp"
#include <algorithm>
#include <cstring>

namespace airbridge::awdl {
namespace {
struct Writer {
    std::uint8_t* bytes;std::size_t capacity,position{};bool valid{true};
    void u8(unsigned value) {if(position==capacity) {valid=false;return;} bytes[position++]=std::uint8_t(value);}
    void u16(unsigned value) {u8(value);u8(value>>8);}
    void u32(std::uint32_t value) {u16(value);u16(value>>16);}
    void block(const std::uint8_t* value,std::size_t count) {
        if(count>capacity-position) {valid=false;return;}
        std::copy_n(value,count,bytes+position);position+=count;
    }
    std::size_t tlv(unsigned tag) {u8(tag);const auto start=position;u16(0);return start;}
    void end(std::size_t start) {
        if(!valid || start+2>position || position-start-2>65535) {valid=false;return;}
        const auto length=position-start-2;bytes[start]=std::uint8_t(length);bytes[start+1]=std::uint8_t(length>>8);
    }
};
void wifi_header(Writer& out,unsigned control,const Mac& source,const Mac& destination,unsigned sequence) {
    constexpr Mac bssid{0,0x25,0,0xff,0x94,0x73};
    out.u16(control);out.u16(0);out.block(destination.data(),6);out.block(source.data(),6);out.block(bssid.data(),6);out.u16((sequence&0xfff)<<4);
}
void plan(Writer& out,const ChannelPlan& channels) {
    // Canonical operating-class encoding, preserving zero/unavailable slots.
    out.u8(15);out.u8(3);out.u8(0);out.u8(3);out.u16(0xffff);
    for(auto channel:channels.channel) {out.u8(channel);out.u8(channel==6 ? 0x51 : channel ? 0x80 : 0);}
}
bool valid_mac(const Mac& mac) {return !(mac[0]&1) && std::any_of(mac.begin(),mac.end(),[](auto c){return c!=0;});}
}

Error encode_ibss_beacon(const Mac& source, std::uint16_t sequence,
                         std::uint64_t now_us, ManagementFrame& output) {
    if (!valid_mac(source)) return Error::malformed;
    ManagementFrame draft{}; Writer out{draft.bytes.data(),draft.bytes.size()};
    Mac broadcast{}; broadcast.fill(255);
    wifi_header(out,0x80,source,broadcast,sequence);
    out.u32(std::uint32_t(now_us)); out.u32(std::uint32_t(now_us>>32));
    out.u16(10000); out.u16(2); // TU interval, IBSS capability.
    constexpr std::uint8_t elements[]={
        0,4,'a','w','d','l',
        1,8,0x82,0x84,0x8b,0x96,0x0c,0x18,0x30,0x6c,
        3,1,6, // DS channel 6.
        6,2,0,0 // IBSS ATIM window zero.
    };
    out.block(elements,sizeof(elements));
    if (!out.valid) return Error::truncated;
    draft.length=out.position; output=draft; return Error::none;
}
bool valid_ibss_beacon(Bytes frame, const Mac& source) {
    if (!frame.data || frame.size<36) return false;
    std::uint64_t timestamp=0;
    for (unsigned i=0;i<8;++i) timestamp|=std::uint64_t(frame.data[24+i])<<(8*i);
    const auto sequence=std::uint16_t((unsigned(frame.data[22])|unsigned(frame.data[23])<<8)>>4);
    ManagementFrame expected{};
    return encode_ibss_beacon(source,sequence,timestamp,expected)==Error::none &&
           frame.size==expected.length && !std::memcmp(frame.data,expected.bytes.data(),frame.size);
}

Error encode_presence(const Presence& state,std::uint8_t kind,std::uint16_t sequence,
                      std::uint64_t now_us,ManagementFrame& output) {
    if(!state.clock.valid() || !valid_mac(state.source) || !valid_mac(state.root) || !valid_mac(state.parent) ||
       state.depth>8 || !state.advertised.mask(6) || (kind!=0 && kind!=3)) return Error::malformed;
    const auto end=std::find(state.host_label.begin(),state.host_label.end(),'\0');
    const auto name_size=std::size_t(end-state.host_label.begin());
    if(!name_size || name_size==state.host_label.size()) return Error::malformed;
    for(std::size_t i=0;i<name_size;i++) if(static_cast<unsigned char>(state.host_label[i])<32) return Error::malformed;
    ManagementFrame draft{};Writer out{draft.bytes.data(),draft.bytes.size()};
    wifi_header(out,0xd0,state.source,state.destination,sequence);
    constexpr std::uint8_t vendor[]={0x7f,0,0x17,0xf2,8,0x10};out.block(vendor,6);out.u8(kind);out.u8(0);
    out.u32(std::uint32_t(now_us));out.u32(std::uint32_t(now_us));
    auto tag=out.tlv(4);
    const auto aw=state.clock.aw_number(now_us),countdown=state.clock.countdown_tu(now_us),period=state.clock.period_tu();
    out.u8(6);out.u16(countdown);out.u8(6);out.u8(0);out.u16(period);out.u16(state.depth ? 440 : 110);out.u16(0x1800);
    out.u16(period);out.u16(period);out.u16(countdown>3u*period ? countdown-3u*period : 0);
    for(unsigned i=0;i<4;i++) out.u8(3);
    out.block(state.root.data(),6);out.u8(4);out.u8(0);out.u16(aw);out.u16(aw);plan(out,state.advertised);out.u16(0);out.end(tag);
    tag=out.tlv(5);out.u8(0);out.u16(0);out.u8(state.depth);out.u8(0);out.block(state.root.data(),6);
    out.u32(state.root_metric);out.u32(state.self_metric);out.u16(0);out.end(tag);
    tag=out.tlv(18);plan(out,state.advertised);out.u16(0);out.u8(0);out.end(tag);
    tag=out.tlv(24);out.block(state.root.data(),6);out.block(state.parent.data(),6);out.u32(state.root_counter);
    out.u32(state.depth);out.u32(state.root_metric);out.u32(state.self_metric);out.u32(0);out.u32(0);out.u32(state.self_counter);out.end(tag);
    tag=out.tlv(6);out.u8(0);out.u8(0);out.u8(0);out.u16(0);out.u32(0);out.end(tag);
    if(kind==3) {
        tag=out.tlv(7);out.u16(0);out.u16(0x11ce);out.u8(0x1b);out.u8(0xff);out.u16(0);out.u8(0);out.end(tag);
        tag=out.tlv(16);out.u8(3);out.u8(unsigned(name_size));out.block(reinterpret_cast<const std::uint8_t*>(state.host_label.data()),name_size);out.u8(0xc0);out.u8(12);out.end(tag);
    }
    // Single-band channel-following profile. Do not advertise Linux adapter
    // capabilities that this 2.4 GHz ESP32-S3 backend cannot provide.
    tag=out.tlv(12);out.u16(0x8384);out.u8('X');out.u8('0');out.u8(0);out.u16(1);out.block(state.source.data(),6);out.u16(8);out.end(tag);
    tag=out.tlv(21);out.u8(0x93);out.u8(1);out.end(tag);
    tag=out.tlv(20);out.block(state.root.data(),6);out.end(tag);
    if(!out.valid) return Error::truncated;
    draft.length=out.position;output=draft;return Error::none;
}

Error encode_ipv6(const Mac& source,const Mac& destination,std::uint16_t data_sequence,
                  std::uint16_t wifi_sequence,Bytes packet,DataFrame& output) {
    if(!valid_mac(source) || !packet.data || packet.size<40 || packet.size>1280 || (packet.data[0]>>4)!=6 ||
       packet.size!=40+std::size_t(unsigned(packet.data[4])<<8 | packet.data[5])) return Error::malformed;
    DataFrame draft{};Writer out{draft.bytes.data(),draft.bytes.size()};
    wifi_header(out,0x88,source,destination,wifi_sequence);out.u16(7);
    constexpr std::uint8_t llc[]={0xaa,0xaa,3,0,0x17,0xf2,8,0};out.block(llc,8);
    out.u16(0x0403);out.u16(data_sequence);out.u16(0);out.u8(0x86);out.u8(0xdd);out.block(packet.data,packet.size);
    if(!out.valid) return Error::truncated;
    draft.length=out.position;output=draft;return Error::none;
}
} // namespace airbridge::awdl
