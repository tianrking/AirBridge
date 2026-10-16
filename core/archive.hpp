// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
#pragma once
#include "awdl.hpp"
namespace airbridge::transfer {
using awdl::Bytes;
using awdl::Error;
struct ArchiveSink {
    void* context{};
    bool (*begin)(void*,const char*,std::uint32_t){};
    bool (*write)(void*,Bytes){};
    bool (*end)(void*){};
};
// Receivers must retain temporary output until finish() validates the archive.
class CpioReader {
public:
    explicit CpioReader(ArchiveSink sink):sink_(sink){}
    Error feed(Bytes input);
    Error finish() const;
    std::uint64_t total_bytes() const {return total_;}
    unsigned files() const {return files_;}
private:
    enum class State {header,name,name_padding,data,data_padding,done,failed};
    ArchiveSink sink_;
    State state_{State::header};
    std::array<char,110> header_{};
    std::array<char,256> name_{};
    std::array<std::array<char,256>,32> seen_{};
    std::size_t have_{},need_{6},padding_{};
    std::uint32_t size_{},remaining_{},mode_{};
    std::uint64_t total_{};
    unsigned files_{};
    bool modern_{},regular_{};
    Error decode_header();
    Error begin_entry();
    Error complete_entry();
};
using Inflate = bool (*)(void*,Bytes,std::uint8_t*,std::size_t,std::size_t&);
class DvZipReader {
public:
    DvZipReader(CpioReader& archive,std::uint8_t* compressed,std::size_t capacity,
        std::uint8_t* expanded,std::size_t expanded_capacity,Inflate inflate,void* context=nullptr):
        archive_(archive),compressed_(compressed),capacity_(capacity),expanded_(expanded),expanded_capacity_(expanded_capacity),inflate_(inflate),context_(context){}
    Error feed(Bytes input);
    Error finish() const;
private:
    CpioReader& archive_;
    std::uint8_t* compressed_;
    std::size_t capacity_;
    std::uint8_t* expanded_;
    std::size_t expanded_capacity_;
    Inflate inflate_;
    void* context_;
    std::array<std::uint8_t,4> header_{};
    std::size_t have_{},length_{},used_{};
    bool stored_{},failed_{};
};
using Emit = bool (*)(void*,Bytes);
bool safe_filename(const char* value);
Error write_cpio_header(const char* filename,std::uint32_t size,Emit emit,void* context);
Error write_cpio_trailer(Emit emit,void* context);
Error write_dvzip_stored(Bytes bytes,Emit emit,void* context);
}
