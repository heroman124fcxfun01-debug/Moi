cmake_minimum_required(VERSION 3.22.1)
project("bookhad_zeroshot_dsp")

add_library(
    bookhad_zeroshot_dsp
    SHARED
    native_dsp_denoise.cpp
)

find_library(log-lib log)

target_link_libraries(
    bookhad_zeroshot_dsp
    ${log-lib}
)
