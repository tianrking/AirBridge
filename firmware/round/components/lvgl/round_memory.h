// AirBridge round-profile allocator adaptation. LVGL objects are not DMA buffers.
#pragma once
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
void* airbridge_lv_malloc(size_t size);
void* airbridge_lv_realloc(void* pointer, size_t size);
void airbridge_lv_free(void* pointer);
#ifdef __cplusplus
}
#endif
