#pragma once

#include "StartupProcess.h"
#include <objbase.h>
#include <evntrace.h>
#include <evntcons.h>
#include <tdh.h>
#include <atomic>
#include <climits>
#include <cstring>
#include <map>
#include <mutex>
#include <set>
#include <thread>

namespace proof {
inline void check(bool value, const char* message) {
    if (!value) throw std::runtime_error(message);
}

inline void pump(DWORD milliseconds = 20) {
    MsgWaitForMultipleObjects(0, nullptr, FALSE, milliseconds, QS_ALLINPUT);
    MSG message{};
    while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
}

template<class Predicate>
void until(Predicate predicate, const char* failure, DWORD timeout = 15000) {
    const auto deadline = GetTickCount64() + timeout;
    do {
        if (predicate()) return;
        pump();
    } while (GetTickCount64() < deadline);
    throw std::runtime_error(failure);
}

inline std::wstring imagePath(HANDLE process) {
    std::vector<wchar_t> buffer(32768);
    DWORD size = static_cast<DWORD>(buffer.size());
    check(QueryFullProcessImageNameW(process, 0, buffer.data(), &size) != FALSE, "process image could not be observed");
    return recap::normalizedPath({ buffer.data(), size });
}

inline void nativeArchitecture(HANDLE process) {
    USHORT emulated = 0, native = 0;
    check(IsWow64Process2(process, &emulated, &native) != FALSE, "native architecture could not be observed");
#if defined(_M_ARM64)
    check(native == IMAGE_FILE_MACHINE_ARM64 && emulated == IMAGE_FILE_MACHINE_UNKNOWN, "ARM64 proof is not native");
#else
    check(native == IMAGE_FILE_MACHINE_AMD64 && emulated == IMAGE_FILE_MACHINE_UNKNOWN, "x64 proof is not native");
#endif
}

inline bool hasConsole(HANDLE process, DWORD pid) {
    check(WaitForSingleObject(process, 0) == WAIT_TIMEOUT, "console probe target was not alive");
    if (GetConsoleWindow()) check(FreeConsole() != FALSE, "observer could not detach its own console");
    if (AttachConsole(pid)) {
        check(FreeConsole() != FALSE, "observer could not detach target console");
        return true;
    }
    const auto error = GetLastError();
    check(error == ERROR_INVALID_HANDLE && WaitForSingleObject(process, 0) == WAIT_TIMEOUT,
          "console attachment was inconclusive");
    return false;
}

struct ProcessEvent {
    DWORD pid = 0, parent = 0;
    bool start = false;
    LONGLONG timestamp = 0;
    std::wstring image, command;
    bool exitKnown = false;
    DWORD exitCode = 0;
};

struct Moment {
    uint64_t tick = 0, qpc = 0;
};

inline Moment moment() {
    LARGE_INTEGER counter{};
    check(QueryPerformanceCounter(&counter) != FALSE, "performance clock unavailable");
    return { GetTickCount64(), static_cast<uint64_t>(counter.QuadPart) };
}

enum class WindowKind { unknown, other, startup, console, terminal };

inline const char* windowKindName(WindowKind kind) {
    switch (kind) {
    case WindowKind::other: return "other";
    case WindowKind::startup: return "startup";
    case WindowKind::console: return "console";
    case WindowKind::terminal: return "terminal";
    default: return "unknown";
    }
}

struct WindowFact {
    DWORD event = 0, owner = 0, thread = 0, sourceThread = 0, generated32 = 0;
    LONG object = 0, child = 0;
    uintptr_t window = 0;
    uint64_t generated = 0;
    Moment received;
    WindowKind kind = WindowKind::unknown;
    bool metadataKnown = false, present = false, visible = false, topLevel = false, onScreen = false;
    RECT rectangle{};
};

inline WindowFact windowFact(HWND window) {
    WindowFact fact;
    fact.window = reinterpret_cast<uintptr_t>(window);
    fact.present = window && IsWindow(window);
    if (!fact.present) return fact;
    fact.thread = GetWindowThreadProcessId(window, &fact.owner);
    wchar_t name[128]{};
    const auto length = GetClassNameW(window, name, static_cast<int>(std::size(name)));
    const bool rectangle = GetWindowRect(window, &fact.rectangle) != FALSE;
    fact.metadataKnown = length > 0 && fact.thread != 0 && fact.owner != 0 && rectangle;
    if (!fact.metadataKnown) return fact;
    fact.kind = wcscmp(name, L"RecapPageStartupWindow") == 0 ? WindowKind::startup
        : wcscmp(name, L"ConsoleWindowClass") == 0 ? WindowKind::console
        : wcscmp(name, L"CASCADIA_HOSTING_WINDOW_CLASS") == 0 ? WindowKind::terminal : WindowKind::other;
    fact.visible = IsWindowVisible(window) != FALSE;
    fact.topLevel = GetAncestor(window, GA_ROOT) == window;
    fact.onScreen = rectangle && fact.rectangle.right > fact.rectangle.left &&
        fact.rectangle.bottom > fact.rectangle.top &&
        MonitorFromRect(&fact.rectangle, MONITOR_DEFAULTTONULL) != nullptr;
    return fact;
}

inline bool visibleIn(const WindowFact& fact, uint64_t begin, uint64_t end, uint64_t receiptLimit = 0) {
    return fact.metadataKnown && fact.topLevel && fact.onScreen &&
        fact.generated >= begin && fact.generated < end &&
        (!receiptLimit || fact.received.qpc < receiptLimit) &&
        (fact.event == EVENT_OBJECT_SHOW || (fact.present && fact.visible));
}

struct ConsoleFact {
    DWORD event = 0, pid = 0, sourceThread = 0, generated32 = 0;
    LONG child = 0;
    uintptr_t window = 0;
    uint64_t generated = 0;
    Moment received;
};

class Observer {
    inline static thread_local Observer* current_ = nullptr;
    std::wstring name_;
    std::vector<unsigned char> properties_;
    TRACEHANDLE session_ = 0, consumer_ = INVALID_PROCESSTRACE_HANDLE;
    std::thread consumerThread_;
    HWINEVENTHOOK consoleHook_ = nullptr;
    HWINEVENTHOOK windowHook_ = nullptr;
    std::mutex mutex_;
    std::vector<ProcessEvent> processes_;
    std::map<DWORD, std::wstring> images_;
    std::vector<ConsoleFact> consoles_;
    std::vector<WindowFact> windows_;
    std::map<uintptr_t, WindowFact> windowMetadata_;
    std::map<DWORD, std::wstring> roots_;
    std::atomic<bool> lost_{ false };
    std::atomic<bool> clockValid_{ true };
    bool stopped_ = false;
    bool windowObservation_ = false;
    uint64_t frequency_ = 0;

    EVENT_TRACE_PROPERTIES* properties() {
        return reinterpret_cast<EVENT_TRACE_PROPERTIES*>(properties_.data());
    }
    static std::vector<unsigned char> property(EVENT_RECORD* event, const wchar_t* name) {
        PROPERTY_DATA_DESCRIPTOR descriptor{};
        descriptor.PropertyName = reinterpret_cast<ULONGLONG>(name);
        descriptor.ArrayIndex = ULONG_MAX;
        ULONG size = 0;
        if (TdhGetPropertySize(event, 0, nullptr, 1, &descriptor, &size) != ERROR_SUCCESS) return {};
        check(size <= 65536, "ETW property exceeded bound");
        std::vector<unsigned char> result(size);
        if (size && TdhGetProperty(event, 0, nullptr, 1, &descriptor, size, result.data()) != ERROR_SUCCESS)
            throw std::runtime_error("ETW property could not be decoded");
        return result;
    }
    static DWORD number(const std::vector<unsigned char>& bytes) {
        DWORD result = 0;
        if (bytes.size() == sizeof(result)) memcpy(&result, bytes.data(), sizeof(result));
        return result;
    }
    static std::wstring wide(const std::vector<unsigned char>& bytes) {
        if (bytes.empty() || bytes.size() % sizeof(wchar_t)) return {};
        std::wstring result(bytes.size() / sizeof(wchar_t), L'\0');
        memcpy(result.data(), bytes.data(), bytes.size());
        while (!result.empty() && result.back() == L'\0') result.pop_back();
        return result;
    }
    static std::wstring narrow(const std::vector<unsigned char>& bytes) {
        if (bytes.empty()) return {};
        const int size = MultiByteToWideChar(CP_ACP, 0, reinterpret_cast<const char*>(bytes.data()),
                                            static_cast<int>(bytes.size()), nullptr, 0);
        if (!size) return {};
        std::wstring result(static_cast<size_t>(size), L'\0');
        MultiByteToWideChar(CP_ACP, 0, reinterpret_cast<const char*>(bytes.data()),
                            static_cast<int>(bytes.size()), result.data(), size);
        while (!result.empty() && !result.back()) result.pop_back();
        return result;
    }
    static void WINAPI record(EVENT_RECORD* event) {
        auto* self = static_cast<Observer*>(event->UserContext);
        if (!self) return;
        try {
            const auto pidBytes = property(event, L"ProcessId");
            if (pidBytes.size() != sizeof(DWORD)) return;
            const DWORD pid = number(pidBytes);
            const auto parentBytes = property(event, L"ParentId");
            std::lock_guard<std::mutex> lock(self->mutex_);
            if (parentBytes.size() == sizeof(DWORD) &&
                (event->EventHeader.EventDescriptor.Opcode == EVENT_TRACE_TYPE_START ||
                 event->EventHeader.EventDescriptor.Opcode == EVENT_TRACE_TYPE_END)) {
                check(self->processes_.size() < 8192, "ETW process bound exceeded");
                const auto exit = property(event, L"ExitStatus");
                self->processes_.push_back({
                    pid, number(parentBytes), event->EventHeader.EventDescriptor.Opcode == EVENT_TRACE_TYPE_START,
                    event->EventHeader.TimeStamp.QuadPart,
                    narrow(property(event, L"ImageFileName")), wide(property(event, L"CommandLine")),
                    exit.size() == sizeof(DWORD), number(exit)
                });
            } else {
                const auto image = wide(property(event, L"FileName"));
                if (image.size() >= 4 && recap::samePath(image.substr(image.size() - 4), L".exe")) {
                    check(self->images_.size() < 4096, "ETW image bound exceeded");
                    self->images_[pid] = image;
                }
            }
        } catch (const std::exception&) {
            self->lost_.store(true);
        }
    }
    uint64_t eventTick(DWORD generated, const Moment& received) {
        const DWORD delay = static_cast<DWORD>(received.tick) - generated;
        if (delay > 120000 || delay > received.tick) {
            lost_.store(true);
            clockValid_.store(false);
        }
        return received.tick - std::min<uint64_t>(delay, received.tick);
    }
    static void CALLBACK consoleEvent(HWINEVENTHOOK, DWORD event, HWND window, LONG object,
                                      LONG child, DWORD thread, DWORD generated) {
        if (!current_) return;
        if (current_->consoles_.size() >= 8192) { current_->lost_.store(true); return; }
        try {
            const auto received = moment();
            current_->consoles_.push_back({
                event, static_cast<DWORD>(object), thread, generated, child,
                reinterpret_cast<uintptr_t>(window), current_->eventTick(generated, received), received
            });
        } catch (const std::exception&) { current_->lost_.store(true); }
    }
    static void CALLBACK windowEvent(HWINEVENTHOOK, DWORD event, HWND window, LONG object,
                                     LONG child, DWORD thread, DWORD generated) {
        if (!current_ || object != OBJID_WINDOW || child != CHILDID_SELF || !window) return;
        try {
            auto fact = windowFact(window);
            const auto cached = current_->windowMetadata_.find(fact.window);
            if (!fact.metadataKnown && event != EVENT_OBJECT_CREATE &&
                cached != current_->windowMetadata_.end()) {
                fact = cached->second;
                fact.present = false;
                fact.visible = false;
            }
            fact.event = event;
            fact.object = object;
            fact.child = child;
            fact.sourceThread = thread;
            fact.generated32 = generated;
            fact.received = moment();
            fact.generated = current_->eventTick(generated, fact.received);
            check(current_->windows_.size() < 8192 && current_->windowMetadata_.size() < 2048,
                  "window observation bound exceeded");
            current_->windows_.push_back(fact);
            if (fact.metadataKnown) current_->windowMetadata_[fact.window] = fact;
        } catch (const std::exception&) { current_->lost_.store(true); }
    }
public:
    explicit Observer(bool observeWindows = false) : windowObservation_(observeWindows) {
        check(current_ == nullptr, "observer already active");
        consoles_.reserve(8192);
        if (windowObservation_) windows_.reserve(8192);
        LARGE_INTEGER frequency{};
        check(QueryPerformanceFrequency(&frequency) != FALSE && frequency.QuadPart > 0, "clock frequency unavailable");
        frequency_ = static_cast<uint64_t>(frequency.QuadPart);
        name_ = L"RecapPageStartupProof-" + std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(GetTickCount64());
        properties_.resize(sizeof(EVENT_TRACE_PROPERTIES) + (name_.size() + 1) * sizeof(wchar_t));
        auto* settings = properties();
        settings->Wnode.BufferSize = static_cast<ULONG>(properties_.size());
        settings->Wnode.Flags = WNODE_FLAG_TRACED_GUID;
        settings->Wnode.ClientContext = 1;
        check(SUCCEEDED(CoCreateGuid(&settings->Wnode.Guid)), "trace identity could not be created");
        settings->BufferSize = 64;
        settings->MinimumBuffers = 8;
        settings->MaximumBuffers = 64;
        settings->LogFileMode = EVENT_TRACE_REAL_TIME_MODE | EVENT_TRACE_SYSTEM_LOGGER_MODE;
        settings->FlushTimer = 1;
        settings->EnableFlags = EVENT_TRACE_FLAG_PROCESS | EVENT_TRACE_FLAG_IMAGE_LOAD | EVENT_TRACE_FLAG_NO_SYSCONFIG;
        settings->LoggerNameOffset = sizeof(EVENT_TRACE_PROPERTIES);
        memcpy(properties_.data() + settings->LoggerNameOffset, name_.c_str(), (name_.size() + 1) * sizeof(wchar_t));
        check(StartTraceW(&session_, name_.c_str(), settings) == ERROR_SUCCESS, "owned ETW session could not start");
        EVENT_TRACE_LOGFILEW log{};
        log.LoggerName = name_.data();
        log.ProcessTraceMode = PROCESS_TRACE_MODE_REAL_TIME | PROCESS_TRACE_MODE_EVENT_RECORD;
        if (windowObservation_) log.ProcessTraceMode |= PROCESS_TRACE_MODE_RAW_TIMESTAMP;
        log.EventRecordCallback = record;
        log.Context = this;
        consumer_ = OpenTraceW(&log);
        if (consumer_ == INVALID_PROCESSTRACE_HANDLE) {
            ControlTraceW(session_, name_.c_str(), properties(), EVENT_TRACE_CONTROL_STOP);
            throw std::runtime_error("ETW consumer could not open");
        }
        current_ = this;
        consoleHook_ = SetWinEventHook(EVENT_CONSOLE_START_APPLICATION, EVENT_CONSOLE_END_APPLICATION,
            nullptr, consoleEvent, 0, 0, WINEVENT_OUTOFCONTEXT);
        if (!consoleHook_) {
            current_ = nullptr;
            CloseTrace(consumer_);
            ControlTraceW(session_, name_.c_str(), properties(), EVENT_TRACE_CONTROL_STOP);
            throw std::runtime_error("console observer could not start");
        }
        if (windowObservation_) {
            windowHook_ = SetWinEventHook(EVENT_OBJECT_CREATE, EVENT_OBJECT_HIDE, nullptr,
                windowEvent, 0, 0, WINEVENT_OUTOFCONTEXT);
            if (!windowHook_) {
                UnhookWinEvent(consoleHook_);
                current_ = nullptr;
                CloseTrace(consumer_);
                ControlTraceW(session_, name_.c_str(), properties(), EVENT_TRACE_CONTROL_STOP);
                throw std::runtime_error("window lifecycle observer could not start");
            }
        }
        try {
            consumerThread_ = std::thread([this] {
                const auto status = ProcessTrace(&consumer_, 1, nullptr, nullptr);
                if (status != ERROR_SUCCESS && status != ERROR_CANCELLED) lost_.store(true);
            });
        } catch (const std::system_error&) {
            if (windowHook_) UnhookWinEvent(windowHook_);
            UnhookWinEvent(consoleHook_);
            current_ = nullptr;
            CloseTrace(consumer_);
            ControlTraceW(session_, name_.c_str(), properties(), EVENT_TRACE_CONTROL_STOP);
            throw;
        }
    }
    ~Observer() {
        if (!stopped_) stop();
    }
    void stop() {
        if (stopped_) return;
        const auto status = ControlTraceW(session_, name_.c_str(), properties(), EVENT_TRACE_CONTROL_STOP);
        if (status != ERROR_SUCCESS) lost_.store(true);
        if (properties()->EventsLost || properties()->LogBuffersLost || properties()->RealTimeBuffersLost) lost_.store(true);
        if (status != ERROR_SUCCESS) CloseTrace(consumer_);
        if (consumerThread_.joinable()) consumerThread_.join();
        if (status == ERROR_SUCCESS) CloseTrace(consumer_);
        pump(0);
        if (consoleHook_ && !UnhookWinEvent(consoleHook_)) lost_.store(true);
        if (windowHook_ && !UnhookWinEvent(windowHook_)) lost_.store(true);
        current_ = nullptr;
        stopped_ = true;
    }
    bool console(DWORD pid, DWORD event = EVENT_CONSOLE_START_APPLICATION) const {
        return std::any_of(consoles_.begin(), consoles_.end(),
            [&](const auto& fact) { return fact.pid == pid && fact.event == event; });
    }
    bool observesWindows() const { return windowObservation_; }
    uint64_t frequency() const { return frequency_; }
    bool clockValid() const { return clockValid_.load(); }
    bool healthy() const { return !lost_.load(); }
    ULONG eventsLost() { return properties()->EventsLost; }
    ULONG buffersLost() { return properties()->LogBuffersLost + properties()->RealTimeBuffersLost; }
    const std::vector<WindowFact>& windows() const { return windows_; }
    const std::vector<ConsoleFact>& consoles() const { return consoles_; }
    bool windowEventSeen(uintptr_t window, DWORD event) const {
        return std::any_of(windows_.begin(), windows_.end(), [&](const auto& fact) {
            return fact.window == window && fact.event == event && fact.metadataKnown;
        });
    }
    bool passiveVisible(uintptr_t window, uint64_t begin, uint64_t end, uint64_t receiptLimit = 0) const {
        return std::any_of(windows_.begin(), windows_.end(), [&](const auto& fact) {
            return fact.window == window && visibleIn(fact, begin, end, receiptLimit);
        });
    }
    std::vector<ProcessEvent> processes() {
        std::lock_guard<std::mutex> lock(mutex_);
        return processes_;
    }
    void assertHealthy() const { check(!lost_.load(), "observer lost data or could not complete capture"); }
    void bindRoot(DWORD pid, HANDLE process) { roots_[pid] = imagePath(process); }
    std::pair<size_t, size_t> entryCounts(const std::wstring& expected) {
        std::lock_guard<std::mutex> lock(mutex_);
        std::set<DWORD> roots, ended;
        for (const auto& event : processes_) {
            if (event.start && recap::samePath(executablePath(event.pid, event), expected)) roots.insert(event.pid);
            if (!event.start) ended.insert(event.pid);
        }
        size_t complete = 0;
        for (const auto pid : roots) if (ended.count(pid)) ++complete;
        return { roots.size(), complete };
    }
    std::vector<DWORD> registeredRoots(const std::wstring& expected, size_t count, DWORD exitCode) {
        check(stopped_, "registered roots require completed capture");
        std::vector<DWORD> roots;
        const auto events = processes();
        for (const auto& event : events) {
            if (!event.start || !recap::samePath(executablePath(event.pid, event), expected)) continue;
            roots.push_back(event.pid);
            roots_[event.pid] = expected;
            check(std::any_of(events.begin(), events.end(), [&](const auto& end) {
                return !end.start && end.pid == event.pid && end.exitKnown && end.exitCode == exitCode;
            }), "registered GUI exit was not confirmed");
        }
        check(roots.size() == count, "registered GUI activation count differed");
        return roots;
    }
    std::wstring executablePath(DWORD pid, const ProcessEvent& event) {
        std::wstring path = event.image;
        if (images_.count(pid)) path = images_.at(pid);
        if (roots_.count(pid)) return roots_.at(pid);
        if (path.compare(0, 8, L"\\Device\\") == 0) {
            for (wchar_t letter = L'A'; letter <= L'Z'; ++letter) {
                const wchar_t drive[] = { letter, L':', 0 };
                wchar_t device[1024]{};
                if (QueryDosDeviceW(drive, device, static_cast<DWORD>(std::size(device)))) {
                    const std::wstring prefix(device);
                    if (path.size() > prefix.size() && recap::samePath(path.substr(0, prefix.size()), prefix))
                        return std::wstring(drive) + path.substr(prefix.size());
                }
            }
        }
        return recap::normalizedPath(path);
    }
    void assertNoConsole(const std::vector<DWORD>& roots, bool installed) {
        check(stopped_, "console verdict requires completed observation");
        assertHealthy();
        const auto events = processes();
        std::map<DWORD, ProcessEvent> starts;
        std::set<DWORD> ends, owned(roots.begin(), roots.end());
        for (const auto& event : events) {
            if (event.start) {
                check(!starts.count(event.pid), "PID reuse made trace identity ambiguous");
                starts.emplace(event.pid, event);
            } else ends.insert(event.pid);
        }
        for (size_t turn = 0; turn <= starts.size(); ++turn) {
            const auto before = owned.size();
            for (const auto& [pid, event] : starts) if (owned.count(event.parent)) owned.insert(pid);
            if (owned.size() == before) break;
        }
        bool coordinator = false, verifier = false, server = false, browser = false;
        wchar_t system[32768]{};
        check(GetSystemDirectoryW(system, static_cast<UINT>(std::size(system))) != 0, "system image root unavailable");
        std::set<std::wstring> packageRuntimes;
        for (const auto pid : roots) {
            check(roots_.count(pid) != 0, "registered GUI path was not bound");
            const auto& image = roots_.at(pid);
            packageRuntimes.insert(image.substr(0, image.find_last_of(L'\\')) + L"\\runtime\\node.exe");
        }
        for (const auto pid : roots) check(starts.count(pid) != 0, "native entry lifecycle was not captured");
        for (const auto pid : owned) {
            check(!console(pid), "product process created or attached to a console");
            const auto found = starts.find(pid);
            if (found == starts.end()) continue;
            const auto& event = found->second;
            const auto path = executablePath(pid, event);
            if (event.command.find(L"Launcher.mjs") != std::wstring::npos) {
                coordinator = true;
                check(std::any_of(packageRuntimes.begin(), packageRuntimes.end(),
                    [&](const auto& expected) { return recap::samePath(path, expected); }),
                    "coordinator image binding was incomplete");
                check(event.command.find(L"--gui-startup-v1") != std::wstring::npos, "coordinator arguments differed");
                check(ends.count(pid) != 0, "coordinator exit lifecycle was not captured");
            }
            if (event.command.find(L"server.mjs") != std::wstring::npos) {
                server = true;
                check(std::any_of(packageRuntimes.begin(), packageRuntimes.end(),
                    [&](const auto& expected) { return recap::samePath(path, expected); }),
                    "server image binding was incomplete");
            }
            const auto name = path.substr(path.find_last_of(L"\\/") + 1);
            if (recap::samePath(name, L"powershell.exe")) {
                verifier = true;
                check(recap::samePath(path, std::wstring(system) + L"\\WindowsPowerShell\\v1.0\\powershell.exe"),
                      "verifier image binding was incomplete");
                check(ends.count(pid) != 0, "verifier lifecycle was incomplete");
            }
            if (recap::samePath(name, L"cmd.exe")) {
                browser = true;
                check(recap::samePath(path, std::wstring(system) + L"\\cmd.exe"), "browser helper image binding was incomplete");
                check(event.command.find(L"http://127.0.0.1:8787/") != std::wstring::npos, "browser helper origin differed");
                check(ends.count(pid) != 0, "browser-command lifecycle was incomplete");
            }
        }
        check(coordinator, "coordinator startup role was not captured");
        if (installed) check(verifier && server && browser, "installed startup role coverage was incomplete");
    }
};
} // namespace proof
