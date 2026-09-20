#pragma once

#include <winsock2.h>
#include <iphlpapi.h>
#include <wbemidl.h>
#include <shellapi.h>
#include "StartupProcess.h"
#include <array>
#include <cstddef>
#include <cstring>
#include <memory>
#include <mutex>
#include <new>
#include <string_view>

namespace recap::ownership {
constexpr DWORD DeadlineMs = 8000;
constexpr DWORD TableLimit = 16 * 1024 * 1024;
constexpr size_t TextLimit = 32767;
constexpr size_t RecordLimit = 256;

enum class Owned { unknown, no, yes };
enum class Stage { process, ipSize, ipQuery, ipDecode, ipOwner, wmi, identity, complete };
enum class Reason { ok, nativeReturn, invalidBuffer, notOwned, mismatch, missing, timeout, exception, invalidResponse };

struct Result {
    Owned owned = Owned::unknown;
    Stage stage = Stage::process;
    Reason reason = Reason::exception;
    int64_t code = -1;
};

inline Result pass() { return { Owned::yes, Stage::complete, Reason::ok, 0 }; }
inline Result unknown(Stage stage, Reason reason, int64_t code) { return { Owned::unknown, stage, reason, code }; }
inline Result foreign(Stage stage, Reason reason) { return { Owned::no, stage, reason, 0 }; }
struct Failure { Result result; };
[[noreturn]] inline void fail(Stage stage, Reason reason, int64_t code) { throw Failure{ unknown(stage, reason, code) }; }

inline const char* stageName(Stage stage) {
    switch (stage) {
    case Stage::process: return "process";
    case Stage::ipSize: return "ip-size";
    case Stage::ipQuery: return "ip-query";
    case Stage::ipDecode: return "ip-decode";
    case Stage::ipOwner: return "ip-owner";
    case Stage::wmi: return "wmi";
    case Stage::identity: return "identity";
    case Stage::complete: return "complete";
    }
    return "process";
}
inline const char* reasonName(Reason reason) {
    switch (reason) {
    case Reason::ok: return "ok";
    case Reason::nativeReturn: return "native-return";
    case Reason::invalidBuffer: return "invalid-buffer";
    case Reason::notOwned: return "not-owned";
    case Reason::mismatch: return "mismatch";
    case Reason::missing: return "missing";
    case Reason::timeout: return "timeout";
    case Reason::exception: return "exception";
    case Reason::invalidResponse: return "invalid-response";
    }
    return "exception";
}
inline std::string record(const Result& result) {
    const char* owned = result.owned == Owned::yes ? "true" : result.owned == Owned::no ? "false" : "null";
    return std::string("{\"schema\":\"RCPN1\",\"owned\":") + owned +
        ",\"stage\":\"" + stageName(result.stage) + "\",\"reason\":\"" + reasonName(result.reason) +
        "\",\"code\":" + std::to_string(result.code) + ",\"helperBits\":" +
        std::to_string(sizeof(void*) * 8) + "}\n";
}

inline bool parsePid(std::wstring_view text, DWORD& pid) {
    if (text.empty() || text.size() > 10 || text.front() == L'0') return false;
    uint64_t value = 0;
    for (const auto ch : text) {
        if (ch < L'0' || ch > L'9') return false;
        value = value * 10 + static_cast<unsigned int>(ch - L'0');
        if (value > MAXDWORD) return false;
    }
    pid = static_cast<DWORD>(value);
    return true;
}

struct Expectations {
    std::wstring node;
    std::wstring server;
    USHORT port = 8787;
};
struct Deadline {
    ULONGLONG start;
    DWORD duration;
    DWORD remaining(ULONGLONG now) const {
        if (now < start || now - start >= duration) return 0;
        return duration - static_cast<DWORD>(now - start);
    }
};
struct Target {
    recap::Handle handle;
    DWORD pid = 0;
    FILETIME creation{};
};

inline bool equalCreation(const FILETIME& a, const FILETIME& b) {
    return a.dwLowDateTime == b.dwLowDateTime && a.dwHighDateTime == b.dwHighDateTime;
}
inline Result decodeListener(const unsigned char* data, size_t bytes, DWORD pid, USHORT port) {
    constexpr size_t offset = offsetof(MIB_TCPTABLE_OWNER_PID, table);
    constexpr size_t stride = sizeof(MIB_TCPROW_OWNER_PID);
    if (!data || bytes < offset || bytes > TableLimit)
        return unknown(Stage::ipDecode, Reason::invalidBuffer, ERROR_INVALID_DATA);
    DWORD count = 0;
    std::memcpy(&count, data, sizeof(count));
    if (count > (bytes - offset) / stride)
        return unknown(Stage::ipDecode, Reason::invalidBuffer, ERROR_INVALID_DATA);
    for (size_t index = 0; index < count; ++index) {
        MIB_TCPROW_OWNER_PID row{};
        std::memcpy(&row, data + offset + index * stride, sizeof(row));
        if (row.dwState == MIB_TCP_STATE_LISTEN && row.dwLocalAddr == htonl(INADDR_LOOPBACK) &&
            ntohs(static_cast<u_short>(row.dwLocalPort)) == port && row.dwOwningPid == pid) return pass();
    }
    return foreign(Stage::ipOwner, Reason::notOwned);
}

template<class Query>
Result listenerWith(Query query, DWORD pid, USHORT port) {
    DWORD size = 0;
    DWORD code = query(nullptr, &size, FALSE, AF_INET, TCP_TABLE_OWNER_PID_LISTENER, 0);
    if (code != ERROR_INSUFFICIENT_BUFFER) return unknown(Stage::ipSize, Reason::nativeReturn, code);
    if (size < offsetof(MIB_TCPTABLE_OWNER_PID, table) || size > TableLimit)
        return unknown(Stage::ipSize, Reason::invalidBuffer, ERROR_INVALID_DATA);
    std::vector<unsigned char> bytes(size);
    const DWORD capacity = size;
    code = query(bytes.data(), &size, FALSE, AF_INET, TCP_TABLE_OWNER_PID_LISTENER, 0);
    if (code != NO_ERROR) return unknown(Stage::ipQuery, Reason::nativeReturn, code);
    if (size > capacity) return unknown(Stage::ipQuery, Reason::invalidBuffer, ERROR_INVALID_DATA);
    return decodeListener(bytes.data(), size, pid, port);
}

inline Result validateCommand(const std::wstring& command, const Expectations& expected) {
    if (command.empty() || command.size() > TextLimit || command.find(L'\0') != std::wstring::npos)
        return unknown(Stage::identity, Reason::invalidResponse, ERROR_INVALID_DATA);
    int count = 0;
    auto* args = CommandLineToArgvW(command.c_str(), &count);
    if (!args) return unknown(Stage::identity, Reason::nativeReturn, GetLastError());
    std::unique_ptr<void, decltype(&LocalFree)> allocation(args, &LocalFree);
    const bool match = count == 2 && recap::samePath(args[0], expected.node) && recap::samePath(args[1], expected.server);
    return match ? pass() : foreign(Stage::identity, Reason::mismatch);
}

class Api {
public:
    virtual ~Api() = default;
    virtual ULONGLONG now() const = 0;
    virtual Result listener(DWORD pid, USHORT port) = 0;
    virtual Result retain(DWORD pid, Target& target) = 0;
    virtual Result image(const Target& target, std::wstring& path) = 0;
    virtual Result commandLine(const Target& target, const Deadline& deadline, std::wstring& command) = 0;
    virtual Result recheck(const Target& target) = 0;
};

inline Result verify(DWORD pid, const Expectations& expected, Api& api, DWORD budgetMs = DeadlineMs) {
    Stage stage = Stage::process;
    try {
        if (!pid || expected.node.empty() || expected.server.empty() || !expected.port || budgetMs > DeadlineMs)
            return unknown(stage, Reason::invalidResponse, ERROR_INVALID_PARAMETER);
        const Deadline deadline{ api.now(), budgetMs };
        const auto checked = [&](Result result) {
            if (!deadline.remaining(api.now())) fail(stage, Reason::timeout, WAIT_TIMEOUT);
            return result;
        };
        if (!deadline.remaining(api.now())) return unknown(stage, Reason::timeout, WAIT_TIMEOUT);
        stage = Stage::ipQuery;
        auto result = checked(api.listener(pid, expected.port));
        if (result.owned != Owned::yes) return result;
        Target target;
        stage = Stage::identity;
        result = checked(api.retain(pid, target));
        if (result.owned != Owned::yes) return result;
        std::wstring image;
        result = checked(api.image(target, image));
        if (result.owned != Owned::yes) return result;
        if (!recap::samePath(image, expected.node)) return foreign(stage, Reason::mismatch);
        stage = Stage::wmi;
        std::wstring command;
        result = checked(api.commandLine(target, deadline, command));
        if (result.owned != Owned::yes) return result;
        stage = Stage::identity;
        const auto identity = checked(validateCommand(command, expected));
        if (identity.owned == Owned::unknown) return identity;
        result = checked(api.recheck(target));
        if (result.owned != Owned::yes) return result;
        stage = Stage::ipQuery;
        result = checked(api.listener(pid, expected.port));
        if (result.owned != Owned::yes) return result;
        stage = Stage::identity;
        result = checked(api.recheck(target));
        return result.owned == Owned::yes ? identity : result;
    } catch (const Failure& error) {
        return error.result;
    } catch (const std::bad_alloc&) {
        return unknown(stage, Reason::exception, E_OUTOFMEMORY);
    } catch (...) {
        return unknown(stage, Reason::exception, E_FAIL);
    }
}

inline std::wstring canonicalFile(const std::wstring& path) {
    recap::Handle file(CreateFileW(path.c_str(), FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_DELETE,
        nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
    if (!file) fail(Stage::identity, Reason::nativeReturn, GetLastError());
    BY_HANDLE_FILE_INFORMATION info{};
    if (!GetFileInformationByHandle(file.get(), &info)) fail(Stage::identity, Reason::nativeReturn, GetLastError());
    if ((info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) || GetFileType(file.get()) != FILE_TYPE_DISK)
        fail(Stage::identity, Reason::invalidResponse, ERROR_INVALID_DATA);
    std::array<wchar_t, 32768> text{};
    const DWORD length = GetFinalPathNameByHandleW(file.get(), text.data(), static_cast<DWORD>(text.size()), FILE_NAME_NORMALIZED);
    if (!length) fail(Stage::identity, Reason::nativeReturn, GetLastError());
    if (length >= text.size()) fail(Stage::identity, Reason::invalidBuffer, ERROR_INSUFFICIENT_BUFFER);
    return recap::normalizedPath(std::wstring(text.data(), length));
}

inline Expectations packagedExpectations() {
    const auto module = canonicalFile(recap::modulePath());
    const auto split = module.find_last_of(L'\\');
    if (split == std::wstring::npos) fail(Stage::identity, Reason::invalidResponse, ERROR_BAD_PATHNAME);
    const auto root = module.substr(0, split == 2 ? 3 : split);
    Expectations expected{ recap::pathJoin(root, L"runtime\\node.exe"), recap::pathJoin(root, L"server.mjs"), 8787 };
    for (const auto* path : { &expected.node, &expected.server }) {
        const auto resolved = canonicalFile(*path);
        if (!recap::insideRoot(root, resolved) || !recap::samePath(*path, resolved))
            fail(Stage::identity, Reason::invalidResponse, ERROR_BAD_PATHNAME);
    }
    return expected;
}

template<class T> class ComRef {
    T* value_ = nullptr;
public:
    ComRef() = default;
    ComRef(const ComRef&) = delete;
    ComRef& operator=(const ComRef&) = delete;
    ~ComRef() { if (value_) value_->Release(); }
    T* get() const { return value_; }
    T** put() { return &value_; }
    T* operator->() const { return value_; }
};
class Bstr {
    BSTR value_;
public:
    explicit Bstr(const wchar_t* text) : value_(SysAllocString(text)) {
        if (!value_) fail(Stage::wmi, Reason::exception, E_OUTOFMEMORY);
    }
    Bstr(const Bstr&) = delete;
    Bstr& operator=(const Bstr&) = delete;
    ~Bstr() { SysFreeString(value_); }
    BSTR get() const { return value_; }
};
struct Variant {
    VARIANT value;
    Variant() { VariantInit(&value); }
    Variant(const Variant&) = delete;
    Variant& operator=(const Variant&) = delete;
    ~Variant() { VariantClear(&value); }
};
inline void requireWmi(HRESULT hr) {
    if (FAILED(hr)) fail(Stage::wmi, Reason::nativeReturn, hr);
}
class ComApartment {
public:
    ComApartment() { requireWmi(CoInitializeEx(nullptr, COINIT_MULTITHREADED)); }
    ComApartment(const ComApartment&) = delete;
    ComApartment& operator=(const ComApartment&) = delete;
    ~ComApartment() { CoUninitialize(); }
};
inline void initializeWmiSecurity() {
    static std::once_flag once;
    static HRESULT result = E_UNEXPECTED;
    std::call_once(once, [] {
        result = CoInitializeSecurity(nullptr, -1, nullptr, nullptr, RPC_C_AUTHN_LEVEL_DEFAULT,
            RPC_C_IMP_LEVEL_IMPERSONATE, nullptr, EOAC_NONE, nullptr);
    });
    requireWmi(result);
}

class WinApi final : public Api {
    static Result live(HANDLE handle, DWORD pid, FILETIME& creation) {
        const DWORD wait = WaitForSingleObject(handle, 0);
        if (wait == WAIT_FAILED) return unknown(Stage::identity, Reason::nativeReturn, GetLastError());
        if (wait != WAIT_TIMEOUT) return unknown(Stage::identity, Reason::missing, ERROR_PROCESS_ABORTED);
        const DWORD actualPid = GetProcessId(handle);
        if (!actualPid) return unknown(Stage::identity, Reason::nativeReturn, GetLastError());
        if (actualPid != pid) return unknown(Stage::identity, Reason::mismatch, ERROR_INVALID_DATA);
        FILETIME exit{}, kernel{}, user{};
        if (!GetProcessTimes(handle, &creation, &exit, &kernel, &user))
            return unknown(Stage::identity, Reason::nativeReturn, GetLastError());
        if (!creation.dwLowDateTime && !creation.dwHighDateTime)
            return unknown(Stage::identity, Reason::invalidResponse, ERROR_INVALID_DATA);
        return pass();
    }
public:
    ULONGLONG now() const override { return GetTickCount64(); }
    Result listener(DWORD pid, USHORT port) override { return listenerWith(GetExtendedTcpTable, pid, port); }
    Result retain(DWORD pid, Target& target) override {
        target.handle = recap::Handle(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, pid));
        if (!target.handle) return unknown(Stage::identity, Reason::nativeReturn, GetLastError());
        target.pid = pid;
        return live(target.handle.get(), pid, target.creation);
    }
    Result image(const Target& target, std::wstring& path) override {
        std::array<wchar_t, 32768> text{};
        DWORD length = static_cast<DWORD>(text.size());
        if (!QueryFullProcessImageNameW(target.handle.get(), 0, text.data(), &length))
            return unknown(Stage::identity, Reason::nativeReturn, GetLastError());
        if (!length || length >= text.size()) return unknown(Stage::identity, Reason::invalidResponse, ERROR_INVALID_DATA);
        path = recap::normalizedPath(std::wstring(text.data(), length));
        return pass();
    }
    Result recheck(const Target& target) override {
        FILETIME retained{};
        auto result = live(target.handle.get(), target.pid, retained);
        if (result.owned != Owned::yes) return result;
        if (!equalCreation(retained, target.creation)) return unknown(Stage::identity, Reason::mismatch, ERROR_INVALID_DATA);
        Target current;
        result = retain(target.pid, current);
        if (result.owned != Owned::yes) return result;
        return equalCreation(current.creation, target.creation)
            ? pass() : unknown(Stage::identity, Reason::mismatch, ERROR_INVALID_DATA);
    }
    Result commandLine(const Target& target, const Deadline& deadline, std::wstring& command) override {
        ComApartment apartment;
        initializeWmiSecurity();
        ComRef<IWbemLocator> locator;
        requireWmi(CoCreateInstance(CLSID_WbemLocator, nullptr, CLSCTX_INPROC_SERVER, IID_IWbemLocator,
            reinterpret_cast<void**>(locator.put())));
        if (!locator.get()) return unknown(Stage::wmi, Reason::invalidResponse, E_UNEXPECTED);
        ComRef<IWbemServices> service;
        Bstr space(L"ROOT\\CIMV2");
        requireWmi(locator->ConnectServer(space.get(), nullptr, nullptr, nullptr, 0, nullptr, nullptr, service.put()));
        if (!service.get()) return unknown(Stage::wmi, Reason::invalidResponse, E_UNEXPECTED);
        requireWmi(CoSetProxyBlanket(service.get(), RPC_C_AUTHN_WINNT, RPC_C_AUTHZ_NONE, nullptr,
            RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE, nullptr, EOAC_NONE));
        if (!deadline.remaining(now())) return unknown(Stage::wmi, Reason::timeout, WAIT_TIMEOUT);
        const auto text = L"SELECT ProcessId, CommandLine FROM Win32_Process WHERE ProcessId = " + std::to_wstring(target.pid);
        Bstr language(L"WQL"), query(text.c_str());
        ComRef<IEnumWbemClassObject> enumerator;
        requireWmi(service->ExecQuery(language.get(), query.get(), WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY,
            nullptr, enumerator.put()));
        if (!enumerator.get()) return unknown(Stage::wmi, Reason::invalidResponse, E_UNEXPECTED);
        struct Rows {
            IWbemClassObject* values[2]{};
            ~Rows() { for (auto* value : values) if (value) value->Release(); }
        } rows;
        const DWORD remaining = deadline.remaining(now());
        if (!remaining) return unknown(Stage::wmi, Reason::timeout, WAIT_TIMEOUT);
        ULONG count = 0;
        const HRESULT hr = enumerator->Next(static_cast<long>(remaining), 2, rows.values, &count);
        requireWmi(hr);
        if (hr == static_cast<HRESULT>(WBEM_S_TIMEDOUT)) return unknown(Stage::wmi, Reason::timeout, hr);
        if (hr == static_cast<HRESULT>(WBEM_S_FALSE) && count == 0) return unknown(Stage::wmi, Reason::missing, hr);
        if (hr != static_cast<HRESULT>(WBEM_S_FALSE) || count != 1 || !rows.values[0] || rows.values[1])
            return unknown(Stage::wmi, Reason::invalidResponse, ERROR_INVALID_DATA);
        Variant pid, line;
        requireWmi(rows.values[0]->Get(L"ProcessId", 0, &pid.value, nullptr, nullptr));
        requireWmi(rows.values[0]->Get(L"CommandLine", 0, &line.value, nullptr, nullptr));
        if (V_VT(&pid.value) != VT_I4 && V_VT(&pid.value) != VT_UI4)
            return unknown(Stage::wmi, Reason::invalidResponse, ERROR_INVALID_DATA);
        const DWORD actualPid = V_VT(&pid.value) == VT_UI4 ? V_UI4(&pid.value) : static_cast<DWORD>(V_I4(&pid.value));
        if (actualPid != target.pid) return unknown(Stage::wmi, Reason::mismatch, ERROR_INVALID_DATA);
        if (V_VT(&line.value) != VT_BSTR || !V_BSTR(&line.value))
            return unknown(Stage::wmi, Reason::missing, ERROR_INVALID_DATA);
        const UINT length = SysStringLen(V_BSTR(&line.value));
        if (!length || length > TextLimit) return unknown(Stage::wmi, Reason::invalidResponse, ERROR_INVALID_DATA);
        command.assign(V_BSTR(&line.value), length);
        return pass();
    }
};
}
