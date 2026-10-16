// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#include "archive.hpp"
#include "presence.hpp"
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
    Capture decoded;CpioReader cpio(sink(decoded));DvZipReader dv(cpio,compressed.data(),compressed.size(),expanded.data(),forbidden_inflate);
    bool good=true;for(std::size_t at=0;at<dvzip.size();at+=13) if(dv.feed({dvzip.data()+at,std::min(std::size_t{13},dvzip.size()-at)})!=Error::none) {good=false;break;}
    check(good && dv.finish()==Error::none && decoded.data==payload && decoded.ends==2,"fragmented DvZip stored blocks preserve archive");
    Capture badout;CpioReader badcpio(sink(badout));DvZipReader bad(badcpio,compressed.data(),compressed.size(),expanded.data(),forbidden_inflate);
    const std::uint8_t huge[]{0xff,0xff,0xff,0xff};check(bad.feed({huge,4})==Error::malformed,"DvZip claimed size is bounded before copy");
    Capture truncout;CpioReader trunccpio(sink(truncout));DvZipReader trunc(trunccpio,compressed.data(),compressed.size(),expanded.data(),forbidden_inflate);
    check(trunc.feed({dvzip.data(),dvzip.size()-1})==Error::none && trunc.finish()==Error::truncated,"partial DvZip block cannot finish");
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
}
unsigned transfer_checks() {archive_tests();aggregate_tests();return count;}
