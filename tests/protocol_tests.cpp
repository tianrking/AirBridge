// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#include "awdl.hpp"
#include "presence.hpp"
#include "discover.hpp"
#include "discover_fixture.hpp"
#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <vector>
#include <string>
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
    // Apple can publish legacy center-channel 151 alongside primary-channel 149.
    std::vector<std::uint8_t> legacy(38);legacy[0]=15;legacy[1]=1;legacy[3]=3;legacy[4]=legacy[5]=255;
    for(unsigned i=0;i<16;i++) {legacy[6+2*i]=0x1d;legacy[7+2*i]=i==8 ? 6 : 151;}
    auto mixed=bytes;mixed.insert(mixed.begin()+76,legacy.begin(),legacy.end());put16(mixed,41,71);
    require(parse_announcement({mixed.data(),mixed.size()},result)==Error::none && result.channels.channel[0]==149 && result.channels.mask(6)==256,"explicit primary-channel plan takes precedence over legacy center channels");
    std::vector<std::uint8_t> other(38);other[0]=15;other[1]=3;other[3]=3;other[4]=other[5]=255;
    append(mixed,18,other);
    require(parse_announcement({mixed.data(),mixed.size()},result)==Error::malformed,"conflicting repeated explicit plans still rejected");
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
static std::vector<std::uint8_t> record(const std::vector<std::uint8_t>& owner,unsigned type,const std::vector<std::uint8_t>& value) {
    std::vector<std::uint8_t> output(2);put16(output,0,unsigned(owner.size()+1));output.insert(output.end(),owner.begin(),owner.end());
    output.push_back(std::uint8_t(type));output.push_back(std::uint8_t(value.size()));output.push_back(std::uint8_t(value.size()>>8));
    output.push_back(0);output.push_back(0);output.insert(output.end(),value.begin(),value.end());return output;
}
static void discovery() {
    const std::vector<std::uint8_t> owner{4,'T','E','S','T',0xc0,7};
    const auto srv=record(owner,33,{0,0,0,0,0x22,0x42,4,'h','o','s','t',0xc0,12}); // port 8770
    ServiceOffer offer{};require(parse_service_record({srv.data(),srv.size()},offer)==Error::none && offer.airdrop && offer.port==8770 && std::strcmp(offer.instance.data(),"test")==0,"fixed dictionary SRV endpoint");
    auto ptr=record({0xc0,7},12,owner);require(parse_service_record({ptr.data(),ptr.size()},offer)==Error::none && offer.airdrop && offer.port==0,"PTR advertises without inventing a port");
    auto txt=record(owner,16,{9,'f','l','a','g','s','=','1','3','7'});require(parse_service_record({txt.data(),txt.size()},offer)==Error::none && offer.airdrop,"bounded TXT strings");
    auto bad=txt;bad.back()=0;bad[14]=255;
    require(parse_service_record({bad.data(),bad.size()},offer)!=Error::none,"TXT length cannot escape value");
    for(std::size_t n=0;n<srv.size();n++) require(parse_service_record({srv.data(),n},offer)!=Error::none,"truncated service rejects");
    auto unknown=record({0xc0,0xfe},33,{0,0,0,0,0x22,0x42,0});require(parse_service_record({unknown.data(),unknown.size()},offer)==Error::unsupported,"unknown dictionary is not a guessed name");
    auto b=action();append(b,2,ptr);append(b,2,srv);append(b,2,txt);Announcement result{};
    require(parse_announcement({b.data(),b.size()},result)==Error::none && result.service.airdrop && result.service.port==8770,"partial service records merge without losing SRV port");
    PeerTable table;table.update(result,-60,1'000'000);result.service={};table.update(result,-60,2'000'000);
    require(table.rows()[0].service_received_us==1'000'000 && table.rows()[0].announcement.service.port==8770,"ordinary announcements do not refresh service timestamp");
}
static void encoding() {
    Presence state{};state.source=self;state.destination.fill(255);state.root=root;state.parent=sender;
    std::copy_n("airbridge-test",14,state.host_label.begin());state.root_metric=530;state.self_metric=32;
    state.root_counter=100;state.self_counter=1;state.depth=2;state.advertised.slot_aw_count=4;
    state.advertised.channel.fill(6);state.clock.observe({root,20,44,16,4},1'000'000);
    ManagementFrame frame{};
    require(encode_presence(state,3,0x123,1'000'000,frame)==Error::none && frame.length<512,"bounded MIF encoding");
    require(frame.bytes[0]==0xd0 && frame.bytes[22]==0x30 && frame.bytes[23]==0x12 && frame.bytes[40]==4 && frame.bytes[41]==73,"literal 802.11 sequence and sync TLV wire layout");
    Announcement parsed{};require(parse_announcement({frame.bytes.data(),frame.length},parsed)==Error::none,"encoded presence parses");
    require(parsed.source==self && parsed.election.parent==sender && parsed.election.root==root && parsed.sync.root==root,"root parent and actual transmitter stay distinct");
    require(parsed.sync.aw_number==46 && parsed.sync.countdown_tu==20 && parsed.channels.mask(6)==65535,"current local-clock fields and pinned channel plan");
    require(std::strcmp(parsed.hostname.data(),"airbridge-test")==0,"MIF owns real host label");
    ManagementFrame psf{};require(encode_presence(state,0,0x124,1'000'000,psf)==Error::none && psf.length<frame.length,"PSF excludes MIF-only identity fields");
    const auto old=frame.length;state.source.fill(0);require(encode_presence(state,3,0,1'000'000,frame)==Error::malformed && frame.length==old,"invalid source leaves output unchanged");
    std::vector<std::uint8_t> packet(1280);packet[0]=0x60;packet[4]=4;packet[5]=216;
    DataFrame encoded{};require(encode_ipv6(self,sender,65535,0x123,{packet.data(),packet.size()},encoded)==Error::none && encoded.length==1322,"maximum IPv6 MTU fits driver frame budget");
    Ipv6Frame ip{};require(parse_ipv6({encoded.bytes.data(),encoded.length},ip)==Error::none && ip.sequence==65535 && ip.source==self && ip.destination==sender,"QoS data roundtrip preserves 16-bit sequence and endpoints");
    packet[5]--;require(encode_ipv6(self,sender,0,0,{packet.data(),packet.size()},encoded)==Error::malformed,"encoder refuses inconsistent IPv6 lengths");
}
static void identities() {
    airbridge::discovery::Identity identity{};
    require(airbridge::discovery::parse_identity_plist({discover_fixture.data(),discover_fixture.size()},identity)==Error::none,"Python plistlib identity fixture");
    require(std::strcmp(identity.name.data(),u8"测试 Mac 🔵")==0 && std::strcmp(identity.model.data(),"MacBookPro")==0,"UTF16 and surrogate pair decode into UTF8");
    require(identity.has_airdropable && identity.airdropable,"actual IsAirDropable boolean");
    for(std::size_t n=0;n<40;n++) require(airbridge::discovery::parse_identity_plist({discover_fixture.data(),n},identity)!=Error::none,"short plist rejects");
    auto corrupt=discover_fixture;std::fill(corrupt.end()-24,corrupt.end()-16,std::uint8_t{255});
    require(airbridge::discovery::parse_identity_plist({corrupt.data(),corrupt.size()},identity)==Error::malformed,"oversized plist object table rejects");
    const auto request=airbridge::discovery::discover_request(111611);
    require(request.size()==72 && request[32]==0x12 && request[33]==0 && request[34]==1 && request[35]==0xb3 && request[36]==0xfb,"independent support-flags request wire bytes");
    std::string header="HTTP/1.1 200 OK\r\nContent-Length: "+std::to_string(discover_fixture.size())+"\r\n\r\n";
    std::vector<std::uint8_t> wire(header.begin(),header.end());wire.insert(wire.end(),discover_fixture.begin(),discover_fixture.end());
    airbridge::discovery::HttpResponse response{};
    require(airbridge::discovery::parse_http_response(wire.data(),wire.size(),response)==Error::none && response.status==200 && response.body.size==discover_fixture.size(),"content-length response");
    std::string chunked="HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n";
    wire.assign(chunked.begin(),chunked.end());
    const std::string prefix="5\r\n";wire.insert(wire.end(),prefix.begin(),prefix.end());
    wire.insert(wire.end(),{'0','\r','\n','\r','\n','\r','\n'}); // payload looks like a terminal chunk
    const auto old=wire;
    require(airbridge::discovery::parse_http_response(wire.data(),wire.size(),response)==Error::truncated && wire==old,"binary terminal-marker lookalike is not completion; partial input unchanged");
    wire.insert(wire.end(),{'0','\r','\n','\r','\n'});
    require(airbridge::discovery::parse_http_response(wire.data(),wire.size(),response)==Error::none && response.body.size==5 && std::memcmp(response.body.data,"0\r\n\r\n",5)==0,"chunk parser consumes actual framed terminator");
    const std::string ambiguous="HTTP/1.1 200 OK\r\nContent-Length: 0\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n";
    wire.assign(ambiguous.begin(),ambiguous.end());
    require(airbridge::discovery::parse_http_response(wire.data(),wire.size(),response)==Error::malformed,"conflicting HTTP framing rejects");
}
int main() {parsing();clocks();selection();data();discovery();encoding();identities();std::cout<<checks<<" protocol checks passed\n";}
