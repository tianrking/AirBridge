idf_component_register(SRCS "board_display.c" "board_input.c" "state.cpp" "screen.cpp" "../../../../core/round_ui.cpp"
  INCLUDE_DIRS "include" "../../../../core"
  REQUIRES esp_lcd esp_driver_gpio esp_driver_spi esp_driver_ledc esp_driver_i2c esp_timer esp_psram nvs_flash lvgl st77916 cjson mbedtls)
target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
