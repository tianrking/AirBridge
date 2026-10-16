// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#include "awdl.hpp"
#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <vector>
using namespace airbridge::awdl;
static unsigned checks;
static void require(bool value,const char* message) {
    ++checks;if(!value) {std::cerr<<"FAIL: "<<message<<"\n";std::exit(1);}
}
static void put16(std::vector<std::uint8_t>& b,std::size_t at,unsigned value) {b[at]=std::uint8_t(value);b[at+1]=std::uint8_t(value>>8);}
static void put32(std::vector<std::uint8_t>& b,std::size_t at,unsigned value) {for(unsigned i=0;i<4;i++) b[at+i]=std::uint8_t(value>>(i*8));}
static const Mac sender{2,1,2,3,4,5},root{2,9,8,7,6,5},self{2,10,20,30,40,50};
static void append(std::vector<std::uint8_t>& b,unsigned tag,const std::vector<std::uint8_t>& v) {
    b.push_back(std::uint8_t(tag));b.push_back(std::uint8_t(v.size()));b.push_back(std::uint8_t(v.size()>>8));b.insert(b.end(),v.begin(),v.end());
}
static std::vector<std::uint8_t> action() {
    std::vector<std::uint8_t> b(40);b[0]=0xd0;std::copy(sender.begin(),sender.end(),b.begin()+10);
    const std::uint8_t header[]={0x7f,0,0x17,0xf2,8,0x10,3,0};std::copy_n(header,8,b.begin()+24);put32(b,36,12345678);
    std::vector<std::uint8_t> sync(33);sync[0]=6;put16(sync,1,20);put16(sync,5,16);sync[27]=4;put16(sync,29,44);std::copy(root.begin(),root.end(),sync.begin()+21);append(b,4,sync);
    std::vector<std::uint8_t> plan(38);plan[0]=15;plan[1]=3;plan[3]=3;plan[4]=plan[5]=0xff;
    for(unsigned i=0;i<16;i++) {plan[6+2*i]=i==8 ? 6 : 149;plan[7+2*i]=i==8 ? 0x51 : 0x80;}append(b,18,plan);
    std::vector<std::uint8_t> election(40);std::copy(root.begin(),root.end(),election.begin());std::copy(root.begin(),root.end(),election.begin()+6);
    put32(election,12,100);put32(election,16,1);put32(election,20,530);put32(election,24,100);put32(election,36,90);append(b,24,election);
    append(b,16,{3,6,'M','y','-','M','a','c',0xc0,0x0c});append(b,21,{0x93,1});return b;
}
static void parsing() {
    auto bytes=action();Announcement result{};
    require(parse_announcement({bytes.data(),bytes.size()},result)==Error::none,"valid MIF");
    require(result.source==sender && result.sync.root==root && result.election.root==root,"addresses from matching fields");
    require(result.channels.mask(6)==256 && result.has_hostname && std::strcmp(result.hostname.data(),"My-Mac")==0,"real hostname and channel plan");
    require(result.election.root_metric==530 && result.election.root_counter==100 && result.sender_timestamp==12345678,"wire counters");
    for(std::size_t n=0;n<40;n++) require(parse_announcement({bytes.data(),n},result)!=Error::none,"short frame rejected");
    auto bad=bytes;bad[41]=0xff;bad[42]=0xff;
    Announcement sentinel{};sentinel.version=0x5a;
    require(parse_announcement({bad.data(),bad.size()},sentinel)==Error::truncated && sentinel.version==0x5a,"atomic output on truncated TLV");
    bad=bytes;append(bad,21,{0x93,1});require(parse_announcement({bad.data(),bad.size()},result)==Error::duplicate,"ambiguous duplicate version rejected");
    bad=bytes;bad.push_back(0);bad.push_back(0);require(parse_announcement({bad.data(),bad.size()},result)==Error::none,"Apple zero padding accepted");
    bad.back()=9;require(parse_announcement({bad.data(),bad.size()},result)==Error::truncated,"nonzero truncated suffix rejected");
    bad=bytes;append(bad,222,{1,2,3});require(parse_announcement({bad.data(),bad.size()},result)==Error::none,"unknown bounded TLV skipped");
    for(unsigned encoding: {0u,1u,3u}) {
        auto b=bytes;const std::size_t body=40+3+33+3;
        b[body+1]=std::uint8_t(encoding);
        for(unsigned i=0;i<16;i++) {if(encoding==0) b[body+6+i]=6;else {b[body+6+2*i]=encoding==1 ? 0x51 : 6;b[body+7+2*i]=encoding==1 ? 6 : 0x51;}}
        require(parse_announcement({b.data(),b.size()},result)==Error::none && result.channels.mask(6)==65535,"all supported channel encodings");
    }
}
static void clocks() {
    Sync sync{root,20,44,16,4};Clock clock;
    require(clock.observe(sync,1'000'000),"clock accepts valid local anchor");
    require(clock.aw_number(1'000'000)==46 && clock.countdown_tu(1'000'000)==20,"countdown places current AW within EAW");
    const auto boundary=1'000'000+20*1024;
    require(clock.aw_number(boundary-1)==47 && clock.countdown_tu(boundary-1)==1,"last microsecond boundary");
    require(clock.aw_number(boundary)==48 && clock.countdown_tu(boundary)==64 && clock.slot(boundary)==12,"exact EAW boundary");
    require(clock.aw_number(boundary+16*1024)==49,"AW advances after 16 TU");
    sync.aw_number=65532;require(clock.observe(sync,1'000'000) && clock.aw_number(boundary)==0,"16 bit AW wrap");
    sync.countdown_tu=65;require(!clock.observe(sync,1'000'000),"invalid observation does not alter clock");
    require(clock.aw_number(boundary)==0,"clock transactional observation");
}
static void selection() {
    auto bytes=action();Announcement info{};parse_announcement({bytes.data(),bytes.size()},info);PeerTable peers;
    peers.update(info,-60,1'000'000);require(peers.select(self,1'000'001)!=nullptr,"valid transmitter selected");
    auto second=info;second.source[5]++;second.election.root_metric++;second.election.root_counter=1;peers.update(second,-65,1'000'100);
    require(peers.select(self,1'000'101)->announcement.source==second.source,"metric wins before counter");
    auto loop=info;loop.source[5]+=2;loop.election.root_metric=9999;loop.election.parent=self;peers.update(loop,-40,1'000'200);
    require(peers.select(self,1'000'201)->announcement.source==second.source,"no parent cycles");
    require(peers.select(self,12'000'000)==nullptr,"expired peers rejected");
    auto partial=second;partial.has_sync=false;partial.has_channels=false;partial.has_hostname=false;peers.update(partial,-64,2'000'000);
    const auto* selected=peers.select(self,2'000'001);require(selected && selected->sync_received_us==1'000'100,"partial update preserves actual sync receive time");
    require(peers.select(self,4'100'101)==nullptr,"fresh management traffic cannot refresh old sync anchor");
}
static void data() {
    std::vector<std::uint8_t> b(82);b[0]=0x88;b[24]=7;std::copy(sender.begin(),sender.end(),b.begin()+10);
    const std::uint8_t header[]={0xaa,0xaa,3,0,0x17,0xf2,8,0,3,4,0x34,0x12,0,0,0x86,0xdd};std::copy_n(header,16,b.begin()+26);b[42]=0x60;
    Ipv6Frame decoded{};require(parse_ipv6({b.data(),b.size()},decoded)==Error::none && decoded.sequence==0x1234 && decoded.packet.size==40,"QoS IPv6 and sequence");
    b[24]|=0x80;require(parse_ipv6({b.data(),b.size()},decoded)==Error::unsupported,"A-MSDU rejected pending bounded decoder");
    b[24]=7;b[47]=1;require(parse_ipv6({b.data(),b.size()},decoded)==Error::malformed,"IPv6 declared size must match");
    auto ll=link_local(sender);require(ll[0]==0xfe && ll[1]==0x80 && ll[8]==0 && ll[11]==0xff && ll[12]==0xfe && ll[15]==5,"EUI-64 identity");
}
int main() {parsing();clocks();selection();data();std::cout<<checks<<" protocol checks passed\n";}
