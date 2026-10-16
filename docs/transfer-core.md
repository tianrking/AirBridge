# Streaming transfer foundation

The independent core now accepts up to sixteen IPv6 packets in one 802.11
A-MSDU. Every subframe is validated before any borrowed view is returned, so
a malformed final subframe cannot cause partial dispatch of an aggregate.

The archive reader accepts odc (`070707`) and newc (`070701`) CPIO, including
zero-length regular files and record alignment. It rejects traversal paths,
Windows device names, symlinks, duplicate names and oversized entries. Directory
trees, hard-link reconstruction and CRC CPIO are not supported. Files are bounded
to 64 MiB total and 32 entries. These bounds are parser limits, not a statement
that the firmware has qualified transfer at those sizes.

DvZip framing is incremental across arbitrary transport chunks. Stored blocks
are emitted independently; compressed blocks are passed to a bounded platform
inflater with a 256 KiB output limit, including Apple's observed 128 KiB blocks. The receiver must retain temporary files
until HTTP framing, DvZip and CPIO finish successfully; the end of an individual
file is not sufficient to publish a completed transfer.

Native MSVC verification: 276 checks, including literal newc bytes, fragmented
odc/DvZip, binary data, malicious names and aggregate truncation. Compressed
inflation is supplied by the platform ROM. Native file acceptance is documented
separately in [native receiving](native-receiving.md); parser limits do not qualify
transfers at the maximum allowed sizes.
