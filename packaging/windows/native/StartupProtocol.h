#pragma once

#include <windows.h>
#include <algorithm>
#include <cstdint>
#include <string>
#include <vector>

namespace recap {
constexpr size_t HeaderSize = 12;
constexpr size_t BodyLimit = 16384;
constexpr size_t FrameLimit = HeaderSize + BodyLimit;
constexpr size_t DiagnosticLimit = 65536;

struct Capture {
    std::vector<unsigned char> output;
    std::vector<unsigned char> diagnostics;
    bool outputOverflow = false;
    bool diagnosticOverflow = false;
};

inline void appendBounded(std::vector<unsigned char>& destination,
                          const unsigned char* bytes, size_t count,
                          size_t limit, bool& overflow) {
    const auto retain = std::min(count, limit - destination.size());
    destination.insert(destination.end(), bytes, bytes + retain);
    overflow = overflow || retain != count;
}

struct Outcome {
    bool opened = false;
    std::wstring detail;
};

struct Frame {
    bool valid = false;
    bool opened = false;
    std::wstring body;
    std::wstring error;
};

inline bool whitespace(wchar_t c) {
    return c == L' ' || c == L'\t' || c == L'\n' || c == 0x00a0 ||
        c == 0x1680 || (c >= 0x2000 && c <= 0x200a) || c == 0x2028 ||
        c == 0x2029 || c == 0x202f || c == 0x205f || c == 0x3000 || c == 0xfeff;
}

inline Frame decodeFrame(const Capture& capture) {
    const auto& bytes = capture.output;
    Frame result;
    const auto invalid = [&](const wchar_t* text) {
        result.error = text;
        return result;
    };
    if (capture.outputOverflow || bytes.size() > FrameLimit)
        return invalid(L"The startup result exceeded its size limit.");
    if (bytes.size() < HeaderSize)
        return invalid(L"The coordinator did not return a complete startup result.");
    if (bytes[0] != 'R' || bytes[1] != 'C' || bytes[2] != 'P' || bytes[3] != 'G' ||
        bytes[4] != 1 || bytes[5] > 1 || bytes[6] != 0 || bytes[7] != 0)
        return invalid(L"The coordinator returned an invalid startup result.");
    const uint32_t length = static_cast<uint32_t>(bytes[8]) |
        (static_cast<uint32_t>(bytes[9]) << 8) |
        (static_cast<uint32_t>(bytes[10]) << 16) |
        (static_cast<uint32_t>(bytes[11]) << 24);
    if (length > BodyLimit || bytes.size() != HeaderSize + length)
        return invalid(L"The startup result was incomplete or contained extra data.");
    if (bytes[5] == 0) {
        if (length != 0) return invalid(L"The opened result contained unexpected error text.");
        result.valid = true;
        result.opened = true;
        return result;
    }
    if (length == 0) return invalid(L"The startup error did not include readable details.");
    const auto* text = reinterpret_cast<const char*>(bytes.data() + HeaderSize);
    const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text,
                                        static_cast<int>(length), nullptr, 0);
    if (size <= 0) return invalid(L"The startup error was not valid UTF-8.");
    result.body.resize(static_cast<size_t>(size));
    if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text,
                            static_cast<int>(length), result.body.data(), size) != size)
        return invalid(L"The startup error could not be decoded.");
    bool readable = false;
    for (const auto c : result.body) {
        if ((c < 32 && c != L'\n' && c != L'\t') || c == 127)
            return invalid(L"The startup error contained unsafe display controls.");
        readable = readable || !whitespace(c);
    }
    if (!readable || result.body.front() == 0xfeff)
        return invalid(L"The startup error did not contain valid readable text.");
    result.valid = true;
    return result;
}

inline std::wstring diagnosticText(const Capture& capture) {
    if (capture.diagnostics.empty() && !capture.diagnosticOverflow) return {};
    std::wstring text;
    bool normalized = false;
    const auto* data = reinterpret_cast<const char*>(capture.diagnostics.data());
    const int length = static_cast<int>(capture.diagnostics.size());
    int size = length ? MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, data, length, nullptr, 0) : 0;
    DWORD flags = MB_ERR_INVALID_CHARS;
    if (length && size == 0) {
        normalized = true;
        flags = 0;
        size = MultiByteToWideChar(CP_UTF8, flags, data, length, nullptr, 0);
    }
    if (size > 0) {
        text.resize(static_cast<size_t>(size));
        if (MultiByteToWideChar(CP_UTF8, flags, data, length, text.data(), size) != size) {
            text = L"Diagnostic text could not be decoded.";
            normalized = true;
        }
        for (auto& c : text) {
            if (c == L'\r') { c = L'\n'; normalized = true; }
            else if ((c < 32 && c != L'\n' && c != L'\t') || c == 127) {
                c = L'?';
                normalized = true;
            }
        }
    } else if (length) {
        text = L"Diagnostic text could not be decoded.";
        normalized = true;
    }
    std::wstring result = L"\n\nCoordinator diagnostics:\n" + text;
    if (normalized) result += L"\nDiagnostic text was not valid UTF-8 or was normalized for display.";
    if (capture.diagnosticOverflow) result += L"\nAdditional diagnostic bytes omitted.";
    return result;
}

inline Outcome interpret(const Capture& capture, bool exitKnown, DWORD exitCode,
                         DWORD ioError = ERROR_SUCCESS) {
    const auto frame = decodeFrame(capture);
    if (frame.valid && frame.opened && exitKnown && exitCode == 0 &&
        capture.diagnostics.empty() && !capture.diagnosticOverflow && ioError == ERROR_SUCCESS)
        return { true, {} };
    Outcome result;
    result.detail = frame.valid && !frame.opened
        ? frame.body : L"Recap Page could not confirm startup.";
    if (!frame.valid) result.detail += L"\n" + frame.error;
    if (!exitKnown) result.detail += L"\nThe coordinator exit status could not be read.";
    else if (!frame.valid || (frame.opened ? exitCode != 0 : exitCode != 1))
        result.detail += L"\nCoordinator exit status: " + std::to_wstring(exitCode) + L".";
    if (frame.valid && frame.opened && !capture.diagnostics.empty())
        result.detail += L"\nThe coordinator reported diagnostics after an opened result.";
    if (ioError != ERROR_SUCCESS)
        result.detail += L"\nStartup I/O failed (Windows error " + std::to_wstring(ioError) + L").";
    result.detail += diagnosticText(capture);
    return result;
}
} // namespace recap
