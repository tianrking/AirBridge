cmake_minimum_required(VERSION 3.20)
file(STRINGS "${CMAKE_CURRENT_LIST_DIR}/../VERSION" PROJECT_VER LIMIT_COUNT 1)
option(AIRBRIDGE_ROUND_DISPLAY "Spotpear V1 360x360 touch display variant" OFF)
if(AIRBRIDGE_ROUND_DISPLAY)
  list(APPEND EXTRA_COMPONENT_DIRS "${CMAKE_CURRENT_LIST_DIR}/round/components/round_display"
    "${CMAKE_CURRENT_LIST_DIR}/round/components/cjson" "${CMAKE_CURRENT_LIST_DIR}/round/components/lvgl" "${CMAKE_CURRENT_LIST_DIR}/round/components/st77916")
endif()
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(airbridge_native)
