#pragma once

#include <windows.h>
#include <algorithm>
#include <atomic>
#include <cstdint>
#include <iterator>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace recap {
constexpr uint64_t StartupTimeout = 180000;
constexpr uint64_t CleanupTimeout = 2000;
constexpr DWORD CoordinatorFlags =
    CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT;

class Handle {
    HANDLE value_ = nullptr;
public:
    Handle() = default;
    explicit Handle(HANDLE value) : value_(value) {}
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    Handle(Handle&& other) noexcept : value_(other.release()) {}
    Handle& operator=(Handle&& other) noexcept {
        if (this != &other) { close(); value_ = other.release(); }
        return *this;
    }
    ~Handle() { close(); }
    HANDLE get() const { return value_; }
    explicit operator bool() const { return value_ && value_ != INVALID_HANDLE_VALUE; }
    HANDLE release() { return std::exchange(value_, nullptr); }
    DWORD close() {
        if (!*this) { value_ = nullptr; return ERROR_SUCCESS; }
        const auto value = release();
        return CloseHandle(value) ? ERROR_SUCCESS : GetLastError();
    }
};

inline std::wstring windowsError(const std::wstring& role, DWORD code) {
    wchar_t buffer[1024]{};
    const auto count = FormatMessageW(FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
        nullptr, code, 0, buffer, static_cast<DWORD>(std::size(buffer)), nullptr);
    std::wstring message(buffer, count);
    while (!message.empty() && (message.back() == L'\r' || message.back() == L'\n'))
        message.pop_back();
    return role + L" (Windows error " + std::to_wstring(code) + L")." +
        (message.empty() ? L"" : L"\n" + message);
}

class WindowsFailure : public std::runtime_error {
public:
    std::wstring detail;
    WindowsFailure(const std::wstring& role, DWORD code)
        : std::runtime_error("Windows startup failed"), detail(windowsError(role, code)) {}
};

inline void require(BOOL success, const wchar_t* role) {
    if (!success) throw WindowsFailure(role, GetLastError());
}

inline std::wstring modulePath() {
    for (DWORD size = 512; size <= 32768; size *= 2) {
        std::vector<wchar_t> buffer(size);
        const auto length = GetModuleFileNameW(nullptr, buffer.data(), size);
        if (!length) throw WindowsFailure(L"The launcher path could not be read", GetLastError());
        if (length < size) return { buffer.data(), length };
    }
    throw WindowsFailure(L"The launcher path is too long", ERROR_FILENAME_EXCED_RANGE);
}

inline std::wstring normalizedPath(std::wstring path) {
    if (path.compare(0, 8, L"\\\\?\\UNC\\") == 0) path = L"\\\\" + path.substr(8);
    else if (path.compare(0, 4, L"\\\\?\\") == 0) path.erase(0, 4);
    while (path.size() > 3 && path.back() == L'\\') path.pop_back();
    return path;
}

inline bool samePath(const std::wstring& a, const std::wstring& b) {
    return a.size() <= 32768 && b.size() <= 32768 &&
        CompareStringOrdinal(a.data(), static_cast<int>(a.size()),
                             b.data(), static_cast<int>(b.size()), TRUE) == CSTR_EQUAL;
}

inline bool insideRoot(const std::wstring& root, const std::wstring& path) {
    if (root.empty()) return false;
    const auto prefix = root.back() == L'\\' ? root : root + L"\\";
    return path.size() > prefix.size() && samePath(path.substr(0, prefix.size()), prefix);
}

inline std::wstring pathJoin(const std::wstring& root, const std::wstring& child) {
    return root + (root.back() == L'\\' ? L"" : L"\\") + child;
}

inline std::wstring finalPath(HANDLE handle) {
    for (DWORD size = 512; size <= 32768; size *= 2) {
        std::vector<wchar_t> buffer(size);
        const auto length = GetFinalPathNameByHandleW(handle, buffer.data(), size, FILE_NAME_NORMALIZED);
        if (!length) throw WindowsFailure(L"A packaged path could not be resolved", GetLastError());
        if (length < size) return normalizedPath({ buffer.data(), length });
    }
    throw WindowsFailure(L"A packaged path is too long", ERROR_FILENAME_EXCED_RANGE);
}

inline Handle readableFile(const std::wstring& path, const wchar_t* role) {
    Handle file(CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_DELETE,
        nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
    if (!file) throw WindowsFailure(role, GetLastError());
    BY_HANDLE_FILE_INFORMATION info{};
    require(GetFileInformationByHandle(file.get(), &info), role);
    if ((info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) || GetFileType(file.get()) != FILE_TYPE_DISK)
        throw WindowsFailure(role, ERROR_INVALID_DATA);
    return file;
}

inline void validateArguments(const std::wstring& arguments) {
    if (arguments.find_first_not_of(L" \t") != std::wstring::npos)
        throw WindowsFailure(L"Recap Page received unexpected startup arguments", ERROR_BAD_ARGUMENTS);
}

struct LaunchPaths { std::wstring root, runtime, coordinator; };

inline LaunchPaths launchPaths(const std::wstring& executable, const std::wstring& arguments) {
    validateArguments(arguments);
    auto module = readableFile(executable, L"The launcher could not read its own file");
    const auto actual = finalPath(module.get());
    const auto slash = actual.find_last_of(L'\\');
    if (slash == std::wstring::npos) throw WindowsFailure(L"The package root is invalid", ERROR_BAD_PATHNAME);
    LaunchPaths paths;
    paths.root = actual.substr(0, slash == 2 ? 3 : slash);
    paths.runtime = pathJoin(paths.root, L"runtime\\node.exe");
    paths.coordinator = pathJoin(paths.root, L"Launcher.mjs");
    for (const auto& item : std::vector<std::pair<std::wstring, const wchar_t*>>{
        { paths.runtime, L"The packaged Node runtime could not be read" },
        { paths.coordinator, L"The packaged startup coordinator could not be read" }
    }) {
        auto file = readableFile(item.first, item.second);
        const auto resolved = finalPath(file.get());
        if (!insideRoot(paths.root, resolved) || !samePath(resolved, item.first))
            throw WindowsFailure(L"A packaged input resolves outside its expected location", ERROR_BAD_PATHNAME);
    }
    return paths;
}

inline std::wstring quoted(const std::wstring& argument) {
    std::wstring result = L"\"";
    size_t slashes = 0;
    for (const auto c : argument) {
        if (c == L'\\') { ++slashes; continue; }
        result.append(c == L'"' ? slashes * 2 + 1 : slashes, L'\\');
        slashes = 0;
        result += c;
    }
    result.append(slashes * 2, L'\\');
    return result + L"\"";
}

inline std::wstring coordinatorCommand(const LaunchPaths& paths) {
    return quoted(paths.runtime) + L" " + quoted(paths.coordinator) + L" --gui-startup-v1";
}

inline bool blockedEnvironment(const std::wstring& entry) {
    const auto equals = entry.find(L'=');
    if (equals == std::wstring::npos || equals == 0) return false;
    const auto name = entry.substr(0, equals);
    return samePath(name, L"NODE_OPTIONS") || samePath(name, L"NODE_PATH");
}

inline std::vector<wchar_t> childEnvironment() {
    auto* raw = GetEnvironmentStringsW();
    if (!raw) throw WindowsFailure(L"The startup environment could not be read", GetLastError());
    struct Release { wchar_t* value; ~Release() { FreeEnvironmentStringsW(value); } } release{ raw };
    std::vector<wchar_t> result;
    for (const wchar_t* entry = raw; *entry;) {
        const std::wstring value(entry);
        if (!blockedEnvironment(value)) {
            result.insert(result.end(), value.begin(), value.end());
            result.push_back(L'\0');
        }
        entry += value.size() + 1;
    }
    result.push_back(L'\0');
    if (result.size() == 1) result.push_back(L'\0');
    return result;
}

enum class ProcessState { running, exited, unreadable };
class Publication {
    std::atomic<bool> claimed_{ false };
public:
    bool claim() { return !claimed_.exchange(true); }
};

struct Supervision {
    bool failed = false;
    bool timedOut = false;
    bool processExited = false;
    bool workerDone = false;
    bool cleanupUncertain = false;
};

// The same finite ownership loop is used by the real handle adapter and deterministic proof.
template<class Operations>
Supervision supervise(Operations& operations, uint64_t started) {
    Supervision result;
    uint64_t cleanupDeadline = 0;
    bool terminationRequested = false;
    for (;;) {
        const auto now = operations.now();
        const auto state = operations.processState();
        result.processExited = state == ProcessState::exited;
        result.workerDone = operations.workerDone();
        const bool timedOut = !result.processExited && now - started >= StartupTimeout;
        result.timedOut = result.timedOut || timedOut;
        result.failed = result.failed || timedOut || state == ProcessState::unreadable || operations.ioFailed();
        if ((result.failed || result.processExited) && cleanupDeadline == 0)
            cleanupDeadline = now + CleanupTimeout;
        if (cleanupDeadline != 0) {
            if (now >= cleanupDeadline && (!result.workerDone || !result.processExited)) {
                result.failed = true;
                result.cleanupUncertain = true;
            }
            if (result.failed) {
                operations.stopIo();
                if (!result.processExited && !terminationRequested) {
                    terminationRequested = true;
                    if (!operations.terminateOwned()) result.cleanupUncertain = true;
                }
                if (!result.workerDone) operations.cancelIo();
            } else {
                operations.finalizeIo();
            }
            if ((result.processExited && result.workerDone) || now >= cleanupDeadline) return result;
        }
        operations.wait(20);
    }
}
} // namespace recap
