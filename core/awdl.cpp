// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#include "awdl.hpp"
#include <algorithm>
#include <cstring>
#include <limits>

namespace airbridge::awdl {
namespace {
std::uint16_t le16(const std::uint8_t* p) { return std::uint16_t(p[0]) | std::uint16_t(p[1])<<8; }
std::uint16_t be16(const std::uint8_t* p) { return std::uint16_t(p[1]) | std::uint16_t(p[0])<<8; }
std::uint32_t le32(const std::uint8_t* p) {
    return std::uint32_t(p[0]) | std::uint32_t(p[1])<<8 | std::uint32_t(p[2])<<16 | std::uint32_t(p[3])<<24;
}
Mac mac(const std::uint8_t* p) { Mac result{};std::copy_n(p,6,result.begin());return result; }
bool unicast(const Mac& value) {
    return !(value[0]&1) && std::any_of(value.begin(),value.end(),[](auto byte){return byte!=0;});
}
Error channels(Bytes value,ChannelPlan& output) {
    if(value.size<6) return Error::truncated;
    const auto* p=value.data;
    if(p[0]!=15 || p[2] || p[3]!=3 || le16(p+4)!=0xffff) return Error::unsupported;
    const unsigned stride=p[1]==0 ? 1 : (p[1]==1 || p[1]==3 ? 2 : 0);
    if(!stride) return Error::unsupported;
    if(value.size<6+16*stride) return Error::truncated;
    output.encoding=p[1];output.slot_aw_count=std::uint8_t(p[3]+1);
    for(unsigned i=0;i<16;i++) output.channel[i]=p[6+i*stride+(p[1]==1 ? 1 : 0)];
    return Error::none;
}
bool fresh(const Peer& peer,std::uint64_t now) {
    return peer.used && now>=peer.seen_us && now-peer.seen_us<=10'000'000;
}
} // namespace

std::uint16_t ChannelPlan::mask(std::uint8_t wanted) const {
    std::uint16_t value=0;
    for(unsigned i=0;i<16;i++) if(channel[i]==wanted) value|=std::uint16_t(1u<<i);
    return value;
}

Error parse_announcement(Bytes frame,Announcement& output) {
    if(!frame.data || frame.size<40) return Error::truncated;
    const auto* bytes=frame.data;
    constexpr std::uint8_t prefix[]={0x7f,0,0x17,0xf2,8,0x10};
    if((bytes[0]&0xfc)!=0xd0 || (bytes[1]&0x43) || std::memcmp(bytes+24,prefix,6)) return Error::not_awdl;
    if(bytes[30]!=0 && bytes[30]!=3) return Error::unsupported;
    Announcement draft{};
    draft.source=mac(bytes+10);draft.destination=mac(bytes+4);
    if(!unicast(draft.source)) return Error::malformed;
    draft.kind=bytes[30];draft.sender_timestamp=le32(bytes+36);
    std::size_t cursor=40;
    bool seen_version=false,seen_legacy=false,explicit_channels_seen=false;
    while(cursor<frame.size) {
        if(frame.size-cursor<3) {
            for(std::size_t i=cursor;i<frame.size;i++) if(bytes[i]) return Error::truncated;
            break;
        }
        const unsigned tag=bytes[cursor];const std::size_t length=le16(bytes+cursor+1);
        cursor+=3;
        if(length>frame.size-cursor) return Error::truncated;
        const auto* p=bytes+cursor;
        switch(tag) {
        case 2: {
            ServiceOffer offer{};auto result=parse_service_record({p,length},offer);
            if(result==Error::unsupported) break;
            if(result!=Error::none) return result;
            if(offer.airdrop) {
                if(draft.service.airdrop && draft.service.instance!=offer.instance) break;
                if(draft.service.port && offer.port && draft.service.port!=offer.port) return Error::malformed;
                if(!offer.port) offer.port=draft.service.port;
                draft.service=offer;
            }
            break;
        }
        case 4:
            if(draft.has_sync) return Error::duplicate;
            if(length<33) return Error::truncated;
            draft.sync={mac(p+21),le16(p+1),le16(p+29),le16(p+5),p[27]};
            if(!draft.sync.aw_period_tu || draft.sync.aw_period_tu>1024 || draft.sync.presence!=4 ||
               !draft.sync.countdown_tu || draft.sync.countdown_tu>std::uint32_t(draft.sync.aw_period_tu)*4 ||
               !unicast(draft.sync.root)) return Error::malformed;
            draft.has_sync=true;
            if(length>33 && !draft.has_channels) {
                auto result=channels({p+33,length-33},draft.channels);
                if(result!=Error::none) return result;
                draft.has_channels=true;
            }
            break;
        case 5:
            if(seen_legacy) return Error::duplicate;
            if(length<21) return Error::truncated;
            seen_legacy=true;
            if(!draft.election.modern) {
                draft.election.root=mac(p+5);draft.election.parent=draft.source;
                draft.election.depth=p[3];draft.election.root_metric=le32(p+11);draft.election.self_metric=le32(p+15);
                draft.has_election=true;
            }
            break;
        case 18: {
            // Prefer the explicit plan. Apple's embedded legacy plan can use a
            // 5 GHz center channel while the opclass plan names the primary.
            ChannelPlan plan{};auto result=channels({p,length},plan);
            if(result!=Error::none) return result;
            if(explicit_channels_seen && draft.channels.channel!=plan.channel) return Error::malformed;
            draft.channels=plan;draft.has_channels=true;
            explicit_channels_seen=true;
            break;
        }
        case 24:
            if(draft.election.modern) return Error::duplicate;
            if(length<40) return Error::truncated;
            draft.election={mac(p),mac(p+6),le32(p+12),le32(p+16),le32(p+20),le32(p+24),le32(p+36),true};
            if(!unicast(draft.election.root) || !unicast(draft.election.parent) || draft.election.depth>32) return Error::malformed;
            draft.has_election=true;
            break;
        case 16:
            if(draft.has_hostname) return Error::duplicate;
            if(length<4 || p[0]!=3 || !p[1] || p[1]>63 || length<std::size_t(p[1])+4) return Error::malformed;
            if(p[2+p[1]]!=0xc0 || p[3+p[1]]!=0x0c) return Error::unsupported;
            for(unsigned i=0;i<p[1];i++) if(p[2+i]<32 || p[2+i]==127) return Error::malformed;
            std::copy_n(p+2,p[1],draft.hostname.begin());draft.has_hostname=true;
            break;
        case 21:
            if(seen_version) return Error::duplicate;
            if(length<2) return Error::truncated;
            draft.version=p[0];draft.device_class=p[1];seen_version=true;
            break;
        default: break; // Unknown bounded TLVs are not an error.
        }
        cursor+=length;
    }
    if(draft.has_sync && draft.has_election && draft.sync.root!=draft.election.root) return Error::malformed;
    output=draft;return Error::none;
}

Error parse_ipv6(Bytes frame,Ipv6Frame& output) {
    if(!frame.data || frame.size<80) return Error::truncated;
    const auto* p=frame.data;
    if((p[0]&0xfc)!=8 && (p[0]&0xfc)!=0x88) return Error::not_awdl;
    if(p[1]&0x43) return Error::unsupported;
    const bool qos=(p[0]&0x80)!=0;
    const std::size_t llc=qos ? 26 : 24;
    if(qos && (p[24]&0x80)) return Error::unsupported; // A-MSDU requires a separate bounded decoder.
    constexpr std::uint8_t signature[]={0xaa,0xaa,3,0,0x17,0xf2,8,0,3,4};
    if(std::memcmp(p+llc,signature,sizeof(signature))) return Error::not_awdl;
    const std::size_t ip=llc+16;
    if(frame.size<ip+40 || (p[ip]>>4)!=6 || p[llc+12] || p[llc+13] || be16(p+llc+14)!=0x86dd) return Error::malformed;
    const std::size_t total=40+be16(p+ip+4);
    if(total>1280 || total!=frame.size-ip) return Error::malformed;
    output={mac(p+10),mac(p+4),le16(p+llc+10),{p+ip,total}};return Error::none;
}

std::array<std::uint8_t,16> link_local(const Mac& address) {
    return {0xfe,0x80,0,0,0,0,0,0,std::uint8_t(address[0]^2),address[1],address[2],0xff,0xfe,address[3],address[4],address[5]};
}

bool Clock::observe(const Sync& sync,std::uint64_t received_us) {
    const std::uint64_t duration=std::uint64_t(sync.aw_period_tu)*sync.presence*1024;
    const std::uint64_t remaining=std::uint64_t(sync.countdown_tu)*1024;
    if(sync.presence!=4 || !sync.aw_period_tu || sync.aw_period_tu>1024 || !remaining || remaining>duration ||
       received_us>std::numeric_limits<std::uint64_t>::max()-remaining) return false;
    boundary_us_=received_us+remaining;
    boundary_aw_=std::uint16_t((sync.aw_number & ~3u)+4);
    period_tu_=sync.aw_period_tu;presence_=sync.presence;valid_=true;return true;
}
std::uint16_t Clock::aw_number(std::uint64_t now) const {
    if(!valid_) return 0;
    const std::uint64_t aw_us=std::uint64_t(period_tu_)*1024;
    if(now>=boundary_us_) return std::uint16_t(boundary_aw_+(now-boundary_us_)/aw_us);
    const auto backwards=(boundary_us_-now-1)/aw_us+1;
    return std::uint16_t(boundary_aw_-backwards);
}
std::uint16_t Clock::countdown_tu(std::uint64_t now) const {
    if(!valid_) return 0;
    const std::uint64_t eaw_us=std::uint64_t(period_tu_)*presence_*1024;
    const auto remaining=now<boundary_us_ ? (boundary_us_-now-1)%eaw_us+1 : eaw_us-(now-boundary_us_)%eaw_us;
    return std::uint16_t((remaining+1023)/1024);
}
std::uint8_t Clock::slot(std::uint64_t now) const { return std::uint8_t((aw_number(now)/4)%16); }

void PeerTable::update(const Announcement& update,std::int8_t rssi,std::uint64_t now) {
    Peer* row=nullptr;
    for(auto& peer:rows_) if(peer.used && peer.announcement.source==update.source) {row=&peer;break;}
    if(!row) for(auto& peer:rows_) if(!fresh(peer,now)) {row=&peer;break;}
    if(!row) row=&*std::min_element(rows_.begin(),rows_.end(),[](const Peer& a,const Peer& b){return a.seen_us<b.seen_us;});
    Announcement merged=update;
    if(row->used && row->announcement.source==update.source && fresh(*row,now)) {
        const auto& old=row->announcement;
        if(!merged.has_sync && old.has_sync) {merged.sync=old.sync;merged.has_sync=true;}
        if(!merged.has_election && old.has_election) {merged.election=old.election;merged.has_election=true;}
        if(!merged.has_channels && old.has_channels) {merged.channels=old.channels;merged.has_channels=true;}
        if(!merged.has_hostname && old.has_hostname) {merged.hostname=old.hostname;merged.has_hostname=true;}
        if(!merged.service.airdrop && old.service.airdrop) merged.service=old.service;
    }
    const auto sync_time=update.has_sync ? now : row->sync_received_us;
    const auto service_time=update.service.airdrop ? now : row->service_received_us;
    *row={merged,now,sync_time,service_time,rssi,true};
}
const Peer* PeerTable::select(const Mac& self,std::uint64_t now) const {
    const Peer* best=nullptr;
    for(const auto& peer:rows_) {
        const auto& info=peer.announcement;const auto& election=info.election;
        if(!fresh(peer,now) || !info.has_sync || !info.has_election || !info.has_channels ||
           !info.channels.mask(6) || info.source==self || election.root==self || election.parent==self ||
           election.depth>=8 || election.root!=info.sync.root || now<peer.sync_received_us ||
           now-peer.sync_received_us>3'000'000) continue;
        if(!best) {best=&peer;continue;}
        const auto& prior=best->announcement.election;
        // omdrop-owl's Apple-compatible metric-first policy, expressed over immutable rows.
        if(election.root_metric!=prior.root_metric ? election.root_metric>prior.root_metric :
           election.root_counter!=prior.root_counter ? election.root_counter>prior.root_counter :
           election.depth!=prior.depth ? election.depth<prior.depth : info.source>best->announcement.source) best=&peer;
    }
    return best;
}
} // namespace airbridge::awdl
