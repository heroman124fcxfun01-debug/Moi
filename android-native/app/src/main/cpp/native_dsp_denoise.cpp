#include <jni.h>
#include <cmath>
#include <vector>
#include <algorithm>

namespace {
constexpr float kPi = 3.14159265358979323846f;

// 2nd-order Butterworth High-Pass Filter (removes < 80Hz mic rumble/hum without touching vocal pitch)
void applyHighPass80Hz(float* samples, int length, int sampleRate) {
    if (length <= 2 || sampleRate <= 0) return;
    const float fc = 80.0f;
    const float omega = 2.0f * kPi * fc / static_cast<float>(sampleRate);
    const float cosW = std::cos(omega);
    const float sinW = std::sin(omega);
    const float alpha = sinW / (2.0f * 0.70710678f);

    const float b0 = (1.0f + cosW) * 0.5f;
    const float b1 = -(1.0f + cosW);
    const float b2 = (1.0f + cosW) * 0.5f;
    const float a0 = 1.0f + alpha;
    const float a1 = -2.0f * cosW;
    const float a2 = 1.0f - alpha;

    const float nb0 = b0 / a0;
    const float nb1 = b1 / a0;
    const float nb2 = b2 / a0;
    const float na1 = a1 / a0;
    const float na2 = a2 / a0;

    float x1 = 0.0f, x2 = 0.0f, y1 = 0.0f, y2 = 0.0f;
    for (int i = 0; i < length; ++i) {
        const float x0 = samples[i];
        const float y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
        x2 = x1; x1 = x0;
        y2 = y1; y1 = y0;
        samples[i] = y0;
    }
}

// Frame-wise adaptive noise-floor expander (reduces room hiss while keeping vocal timbre untouched)
void applyAdaptiveNoiseGate(float* samples, int length, int sampleRate) {
    const int frameSize = std::max(160, sampleRate / 100); // 10ms frames
    const int numFrames = length / frameSize;
    if (numFrames <= 4) return;

    std::vector<float> frameRms(numFrames, 0.0f);
    for (int f = 0; f < numFrames; ++f) {
        double sumSq = 0.0;
        const int base = f * frameSize;
        for (int i = 0; i < frameSize; ++i) {
            const float s = samples[base + i];
            sumSq += static_cast<double>(s) * static_cast<double>(s);
        }
        frameRms[f] = static_cast<float>(std::sqrt(sumSq / frameSize));
    }

    // Estimate stationary background noise floor from lowest 15% energy frames
    std::vector<float> sortedRms = frameRms;
    std::sort(sortedRms.begin(), sortedRms.end());
    const float noiseFloor = sortedRms[std::max(0, static_cast<int>(numFrames * 0.15f))];
    const float gateThreshold = std::max(0.005f, noiseFloor * 2.1f);

    float smoothedGain = 1.0f;
    for (int f = 0; f < numFrames; ++f) {
        const float rms = frameRms[f];
        float targetGain = 1.0f;
        if (rms < gateThreshold) {
            const float ratio = rms / std::max(1e-6f, gateThreshold);
            // Smooth soft-knee attenuation (never hard-cuts breathing or consonants)
            targetGain = std::max(0.12f, ratio * ratio);
        }
        const int base = f * frameSize;
        for (int i = 0; i < frameSize; ++i) {
            smoothedGain = 0.96f * smoothedGain + 0.04f * targetGain;
            samples[base + i] *= smoothedGain;
        }
    }
}
} // namespace

extern "C" JNIEXPORT void JNICALL
Java_com_bookhad_app_ai_AudioPreprocessor_nativeDenoisePcmInPlace(
    JNIEnv* env,
    jobject /* thiz */,
    jfloatArray pcmArray,
    jint sampleRate
) {
    if (pcmArray == nullptr) return;
    const jsize length = env->GetArrayLength(pcmArray);
    if (length <= 0) return;

    jfloat* data = env->GetFloatArrayElements(pcmArray, nullptr);
    if (data == nullptr) return;

    applyHighPass80Hz(data, static_cast<int>(length), static_cast<int>(sampleRate));
    applyAdaptiveNoiseGate(data, static_cast<int>(length), static_cast<int>(sampleRate));

    env->ReleaseFloatArrayElements(pcmArray, data, 0);
}
