idf_component_register(SRCS "scanner.cpp" "../../core/awdl.cpp"
  INCLUDE_DIRS "../../core" REQUIRES esp_wifi esp_event esp_netif nvs_flash esp_timer)
target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
