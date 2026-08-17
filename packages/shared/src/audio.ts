export const SAMPLE_RATE = 48_000;
export const OPUS_FRAME_SAMPLES = 240;
export const OPUS_FRAME_MS = 5;
export const OPUS_BITRATE = 128_000;
export const OPUS_COMPLEXITY = 5;
export const PACKET_VERSION = 1;
export const PACKET_HEADER_SIZE = 20;
export const FLAG_PLC = 1 << 0;
export const FLAG_KEYFRAME = 1 << 1;
export const MODE_LIVE = 0;
export const MODE_GRID = 1;

export const RING_HEADER_INTS = 8;
export const RING_WRITE = 0;
export const RING_READ = 1;
export const RING_FRAME = 2;
export const RING_UNDERRUNS = 3;
export const RING_PRIMED = 4;
export const RING_CAPACITY = 16_384;

export const DEJITTER_MIN_PACKETS = 4;
export const DEJITTER_MAX_PACKETS = 8;
export const DEJITTER_DEFAULT_PACKETS = 6;

export const DATA_CHANNEL_ID = 1;
export const DATA_CHANNEL_LABEL = "audio";
