// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#include "archive.hpp"
#include "presence.hpp"
#include "native_service.hpp"
#include "ask_fixture.hpp"
#include "serial_protocol.hpp"
#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>
#include <vector>
using namespace airbridge::transfer;
namespace {
unsigned count;
void check(bool okay,const char* message) {++count;if(!okay) {std::cerr<<"FAIL: "<<message<<'\n';std::exit(1);}}
struct Capture {std::vector<std::uint8_t> data;std::vector<std::string> names;unsigned ends{};};
bool emit(void* context,Bytes bytes) {auto& data=*static_cast<std::vector<std::uint8_t>*>(context);data.insert(data.end(),bytes.data,bytes.data+bytes.size);return true;}
ArchiveSink sink(Capture& target) {
    return {&target,[](void* p,const char* name,std::uint32_t){static_cast<Capture*>(p)->names.emplace_back(name);return true;},
        [](void* p,Bytes bytes){auto& out=static_cast<Capture*>(p)->data;out.insert(out.end(),bytes.data,bytes.data+bytes.size);return true;},
        [](void* p){++static_cast<Capture*>(p)->ends;return true;}};
}
bool forbidden_inflate(void*,Bytes,std::uint8_t*,std::size_t,std::size_t&) {return false;}
void archive_tests() {
    std::vector<std::uint8_t> archive;
    std::vector<std::uint8_t> payload(65537);for(std::size_t i=0;i<payload.size();i++) payload[i]=std::uint8_t((i*17)^0x99);
    check(write_cpio_header("binary.bin",std::uint32_t(payload.size()),emit,&archive)==Error::none,"odc writer accepts binary file");
    archive.insert(archive.end(),payload.begin(),payload.end());
    check(write_cpio_header("empty.txt",0,emit,&archive)==Error::none && write_cpio_trailer(emit,&archive)==Error::none,"empty file and trailer encoding");
    check(std::memcmp(archive.data(),"070707",6)==0 && std::memcmp(archive.data()+59,"000015",6)==0,"literal odc namesize field counts ./ and NUL");
    for(const std::size_t step : {std::size_t{1},std::size_t{7},std::size_t{4096},archive.size()}) {
        Capture output;CpioReader reader(sink(output));bool valid=true;
        for(std::size_t at=0;at<archive.size();at+=step) if(reader.feed({archive.data()+at,std::min(step,archive.size()-at)})!=Error::none) {valid=false;break;}
        check(valid && reader.finish()==Error::none && output.data==payload && output.ends==2 && reader.total_bytes()==payload.size() && output.names==std::vector<std::string>{"binary.bin","empty.txt"},"fragmented odc reader publishes exact files");
    }
    for(const char* bad : {"../escape","C:evil","/root","foo\\bar","bad.","bad ","","..","con.txt","NUL","Lpt1.bin"}) check(!safe_filename(bad),"unsafe output filename rejects");
    std::vector<std::uint8_t> duplicate;
    write_cpio_header("same",0,emit,&duplicate);write_cpio_header("same",0,emit,&duplicate);write_cpio_trailer(emit,&duplicate);
    Capture dup;CpioReader dupreader(sink(dup));check(dupreader.feed({duplicate.data(),duplicate.size()})==Error::duplicate,"repeated archive filename rejects");
    Capture incomplete;CpioReader partial(sink(incomplete));partial.feed({archive.data(),archive.size()-1});check(partial.finish()==Error::truncated,"missing trailer NUL is not successful delivery");
    auto traversal=archive;traversal[76]='.';traversal[77]='.';traversal[78]='/';
    Capture unsafe;CpioReader guard(sink(unsafe));check(guard.feed({traversal.data(),traversal.size()})!=Error::none && unsafe.names.empty(),"untrusted archive cannot begin traversal file");
    auto symlink=archive;std::memcpy(symlink.data()+18,"120777",6);Capture link;CpioReader links(sink(link));
    check(links.feed({symlink.data(),symlink.size()})==Error::unsupported,"symlinks are not extracted");
    std::vector<std::uint8_t> dvzip;check(write_dvzip_stored({archive.data(),archive.size()},emit,&dvzip)==Error::none && dvzip[0]==0x80 && dvzip[1]==1,"DvZip 65536-byte stored block has correct big-endian bit");
    std::vector<std::uint8_t> compressed(66560),expanded(65536);
    Capture decoded;CpioReader cpio(sink(decoded));DvZipReader dv(cpio,compressed.data(),compressed.size(),expanded.data(),expanded.size(),forbidden_inflate);
    bool good=true;for(std::size_t at=0;at<dvzip.size();at+=13) if(dv.feed({dvzip.data()+at,std::min(std::size_t{13},dvzip.size()-at)})!=Error::none) {good=false;break;}
    check(good && dv.finish()==Error::none && decoded.data==payload && decoded.ends==2,"fragmented DvZip stored blocks preserve archive");
    Capture badout;CpioReader badcpio(sink(badout));DvZipReader bad(badcpio,compressed.data(),compressed.size(),expanded.data(),expanded.size(),forbidden_inflate);
    const std::uint8_t huge[]{0xff,0xff,0xff,0xff};check(bad.feed({huge,4})==Error::malformed,"DvZip claimed size is bounded before copy");
    Capture truncout;CpioReader trunccpio(sink(truncout));DvZipReader trunc(trunccpio,compressed.data(),compressed.size(),expanded.data(),expanded.size(),forbidden_inflate);
    check(trunc.feed({dvzip.data(),dvzip.size()-1})==Error::none && trunc.finish()==Error::truncated,"partial DvZip block cannot finish");
    std::vector<std::uint8_t> big;const std::vector<std::uint8_t> raw128(131073,0xa5);
    write_cpio_header("large.bin",unsigned(raw128.size()),emit,&big);big.insert(big.end(),raw128.begin(),raw128.end());write_cpio_trailer(emit,&big);
    std::vector<std::uint8_t> apple{0x80,2,0,0};apple.insert(apple.end(),big.begin(),big.begin()+131072);
    write_dvzip_stored({big.data()+131072,big.size()-131072},emit,&apple);
    compressed.resize(263168);expanded.resize(262144);
    Capture large;CpioReader lc(sink(large));DvZipReader ld(lc,compressed.data(),compressed.size(),expanded.data(),expanded.size(),forbidden_inflate);
    check(ld.feed({apple.data(),apple.size()})==Error::none && ld.finish()==Error::none && large.data==raw128,"Apple-sized 128 KiB DvZip record is not limited to Linux writer's 64 KiB default");
    // Independent literal newc fixture: header, file name, padding, bytes, trailer.
    std::string raw="07070100000001000081A40000000000000000000000010000000000000003000000000000000000000000000000000000000200000000";
    check(raw.size()==110,"literal newc header length");
    std::vector<std::uint8_t> newc(raw.begin(),raw.end());newc.insert(newc.end(),{'x',0,1,2,3,0});
    std::string tail="07070100000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000B00000000";
    newc.insert(newc.end(),tail.begin(),tail.end());const char end[]="TRAILER!!!";newc.insert(newc.end(),end,end+sizeof(end));newc.insert(newc.end(),3,0);
    Capture nc;CpioReader nr(sink(nc));check(nr.feed({newc.data(),newc.size()})==Error::none && nr.finish()==Error::none && nc.data==std::vector<std::uint8_t>{1,2,3},"independent newc alignment fixture");
}
void aggregate_tests() {
    using namespace airbridge::awdl;
    const Mac src{2,1,2,3,4,5},dst{2,6,7,8,9,10};
    std::array<std::uint8_t,43> packet{};packet[0]=0x60;packet[5]=3;
    DataFrame single{};check(encode_ipv6(src,dst,1,7,{packet.data(),packet.size()},single)==Error::none,"aggregate input packet");
    std::vector<std::uint8_t> aggregate(single.bytes.begin(),single.bytes.begin()+26);aggregate[24]|=0x80;
    auto append=[&]() {aggregate.insert(aggregate.end(),dst.begin(),dst.end());aggregate.insert(aggregate.end(),src.begin(),src.end());aggregate.push_back(0);aggregate.push_back(59);aggregate.insert(aggregate.end(),single.bytes.begin()+26,single.bytes.begin()+std::ptrdiff_t(single.length));};
    append();aggregate.insert(aggregate.end(),3,0);append();
    Ipv6Batch batch{};check(parse_ipv6_batch({aggregate.data(),aggregate.size()},batch)==Error::none && batch.count==2 && batch.frames[1].source==src && batch.frames[1].packet.size==43,"two A-MSDU subframes and padding decode");
    batch.count=9;aggregate.pop_back();check(parse_ipv6_batch({aggregate.data(),aggregate.size()},batch)==Error::truncated && batch.count==9,"truncated final aggregate cannot publish earlier subframe");
    aggregate[38]=0xff;aggregate[39]=0xff;check(parse_ipv6_batch({aggregate.data(),aggregate.size()},batch)==Error::truncated,"aggregate length cannot escape frame");
}
void native_tests() {
    using namespace airbridge::native;
    Request request{};
    const std::string header="POST /Upload HTTP/1.1\r\nTransfer-Encoding: chunked\r\nContent-Type: application/x-dvzip\r\nTransferID: abc-123\r\nTotalBytes: 9\r\nExpect: 100-continue\r\n\r\n";
    check(parse_request({reinterpret_cast<const std::uint8_t*>(header.data()),header.size()},request)==Error::none && request.chunked && request.expect_continue && request.total_bytes==9 && !std::strcmp(request.path.data(),"/Upload"),"literal native upload headers");
    std::vector<std::uint8_t> output;BodyDecoder body(request,emit,&output);
    const std::string wire="5\r\n0\r\n\r\n\r\n4;tag=ok\r\nABCD\r\n0\r\nChecksum: test\r\n\r\nNEXT";
    std::size_t cursor=0;bool good=true;
    while(cursor<wire.size() && !body.complete()) {std::size_t used=0;if(body.feed({reinterpret_cast<const std::uint8_t*>(wire.data()+cursor),1},used)!=Error::none || !used) {good=false;break;}cursor+=used;}
    check(good && body.complete() && output==std::vector<std::uint8_t>{'0','\r','\n','\r','\n','A','B','C','D'} && wire.substr(cursor)=="NEXT","fragmented HTTP body and trailers leave pipelined bytes unconsumed");
    const std::string mixed="POST /Ask HTTP/1.1\r\nContent-Length: 0\r\nTransfer-Encoding: chunked\r\n\r\n";
    check(parse_request({reinterpret_cast<const std::uint8_t*>(mixed.data()),mixed.size()},request)==Error::malformed,"HTTP request rejects conflicting lengths");
    const std::string duplicate="POST /Ask HTTP/1.1\r\nContent-Length: 1\r\nContent-Length: 1\r\n\r\n";
    check(parse_request({reinterpret_cast<const std::uint8_t*>(duplicate.data()),duplicate.size()},request)==Error::malformed,"duplicate request length rejects");
    AskManifest ask{};check(parse_ask({ask_fixture.data(),ask_fixture.size()},ask)==Error::none && ask.count==2 && ask.total==131073 && !std::strcmp(ask.sender.data(),u8"测试 Mac") && !std::strcmp(ask.files[1].name.data(),u8"空.txt"),"Python plistlib Ask fixture preserves names, total and empty file");
    check(!std::strcmp(ask.transfer_id.data(),"12345678-1234-4321-ABCD-0123456789AB"),"Ask reads nested TransferID id");
    for(std::size_t n=0;n<40;n++) check(parse_ask({ask_fixture.data(),n},ask)!=Error::none,"short Ask cannot allocate files");
    const airbridge::awdl::Mac mac{2,1,2,3,4,5};MdnsPacket announcement{};
    check(mdns_announcement(mac,8770,0,announcement)==Error::none && announcement.size<512 && announcement.bytes[2]==0x84 && announcement.bytes[7]==4,"bounded mDNS announcement contains four answers");
    const std::string wire_host="airbridge-020102030405";
    check(std::search(announcement.bytes.begin(),announcement.bytes.begin()+std::ptrdiff_t(announcement.size),wire_host.begin(),wire_host.end())!=announcement.bytes.begin()+std::ptrdiff_t(announcement.size),"mDNS host retains the complete twelve-digit identity");
    MdnsPacket maximum_label{};const airbridge::awdl::Mac maximum_mac{0xfe,0xff,0xff,0xff,0xff,0xff};
    const std::string maximum_host="airbridge-feffffffffff";
    check(mdns_announcement(maximum_mac,8770,0,maximum_label)==Error::none && std::search(maximum_label.bytes.begin(),maximum_label.bytes.begin()+std::ptrdiff_t(maximum_label.size),maximum_host.begin(),maximum_host.end())!=maximum_label.bytes.begin()+std::ptrdiff_t(maximum_label.size),"mDNS host remains bounded with maximum octets");
    const auto ip=airbridge::awdl::link_local(mac);check(std::equal(ip.begin(),ip.end(),announcement.bytes.begin()+std::ptrdiff_t(announcement.size-16)),"mDNS AAAA matches actual AWDL identity");
    const std::uint8_t query[]{0,0,0,0,0,1,0,0,0,0,0,0,8,'_','a','i','r','d','r','o','p',4,'_','t','c','p',5,'l','o','c','a','l',0,0,12,0,1};
    check(mdns_question({query,sizeof(query)},mac),"literal AirDrop PTR question matches");
    std::vector<std::uint8_t> cycle{0,0,0,0,0,1,0,0,0,0,0,0,0xc0,12,0,12,0,1};
    check(!mdns_question({cycle.data(),cycle.size()},mac),"DNS pointer cycle rejects");
}
void serial_tests() {
    using namespace airbridge::serial;
    const std::string checksum="123456789";
    check(crc32({reinterpret_cast<const std::uint8_t*>(checksum.data()),checksum.size()})==0xcbf43926u,"IEEE CRC32 canonical vector");
    const std::string literal="AB2 17 HELLO *414b814b\n";Command command{};
    check(parse_command({reinterpret_cast<const std::uint8_t*>(literal.data()),literal.size()},command)==Error::none && command.sequence==17 && !std::strcmp(command.body.data(),"HELLO"),"Python zlib independently checks literal serial command");
    const std::string crlf="AB2 18 DATA 0 YWJj *0d48aba4\r\n";
    Command data{};check(parse_command({reinterpret_cast<const std::uint8_t*>(crlf.data()),crlf.size()},data)==Error::none && data.sequence==18,"UART CRLF and data payload");
    for(std::size_t i=4;i<literal.size()-1;i++) {
        auto corrupt=literal;corrupt[i]^=1;Command untouched{};untouched.sequence=99;
        check(parse_command({reinterpret_cast<const std::uint8_t*>(corrupt.data()),corrupt.size()},untouched)!=Error::none && untouched.sequence==99,"corrupted serial frame cannot publish a command");
    }
    ReplayGuard guard;check(guard.check(command)==Replay::fresh,"first command is fresh");guard.remember(command);
    check(guard.check(command)==Replay::repeat,"identical last command can replay acknowledgement");
    auto collision=command;collision.body[0]='X';check(guard.check(collision)==Replay::conflict,"CRC equality alone cannot alias a different operation");
    check(guard.check(data)==Replay::fresh,"higher sequence can execute once");guard.remember(data);
    check(guard.check(command)==Replay::stale,"old commands cannot replay a mutation");
    guard.reset();check(guard.check(command)==Replay::fresh,"explicit session reset permits fresh sequence");
    LineDecoder decoder;Bytes completed{nullptr,99};unsigned ready=0,overflow=0;
    for(const auto c:literal) if(decoder.push(std::uint8_t(c),completed)==LineResult::ready) ++ready;
    check(ready==1 && completed.size==literal.size() && !std::memcmp(completed.data,literal.data(),literal.size()),"driver fragments preserve the entire CRC-protected record");
    const std::string oversized(500,'x');
    for(const auto c:oversized) if(decoder.push(std::uint8_t(c),completed)==LineResult::overflow) ++overflow;
    decoder.push('\n',completed);ready=0;
    for(const auto c:literal) if(decoder.push(std::uint8_t(c),completed)==LineResult::ready) ++ready;
    check(overflow==1 && ready==1 && completed.size==literal.size(),"oversized command discards through newline and resynchronizes once");
    const std::string maximum_line=std::string(223,'x')+'\n';ready=0;
    for(const auto c:maximum_line) if(decoder.push(std::uint8_t(c),completed)==LineResult::ready) ++ready;
    check(ready==1 && completed.size==224,"maximum physical record fits without a terminator overflow");
    decoder.push('x',completed);decoder.reset();ready=0;
    for(const auto c:literal) if(decoder.push(std::uint8_t(c),completed)==LineResult::ready) ++ready;
    check(ready==1 && parse_command(completed,command)==Error::none,"explicit decoder reset clears a partial record");
}
}
unsigned transfer_checks() {archive_tests();aggregate_tests();native_tests();serial_tests();return count;}
