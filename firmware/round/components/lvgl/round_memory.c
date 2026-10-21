#include "round_memory.h"

#include "esp_heap_caps.h"
void* airbridge_lv_malloc(size_t size) {
    return heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
}
void* airbridge_lv_realloc(void* pointer, size_t size) {
    return heap_caps_realloc(pointer, size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
}
void airbridge_lv_free(void* pointer) { heap_caps_free(pointer); }
