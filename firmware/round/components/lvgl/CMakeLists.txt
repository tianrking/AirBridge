file(GLOB_RECURSE SOURCES "src/*.c")
idf_component_register(SRCS ${SOURCES} "round_memory.c" INCLUDE_DIRS "." REQUIRES heap)
target_compile_definitions(${COMPONENT_LIB} PUBLIC LV_MEM_CUSTOM=1
  LV_MEM_CUSTOM_INCLUDE="round_memory.h" LV_MEM_CUSTOM_ALLOC=airbridge_lv_malloc
  LV_MEM_CUSTOM_REALLOC=airbridge_lv_realloc LV_MEM_CUSTOM_FREE=airbridge_lv_free)
